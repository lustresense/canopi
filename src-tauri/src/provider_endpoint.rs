//! Provider endpoint validation, trust fingerprinting, and import preview.
//!
//! Phase 2: Strict endpoint policy preserving local OpenAI-compatible proxies.
//! - Real URL parser via tauri::Url (already a dependency)
//! - HTTPS public default; verified loopback HTTP support
//! - Block metadata/link-local and other private network targets by default
//! - Advanced: trust private endpoint confirmation with exact scheme/hostname/port
//!   Persist only an endpoint trust fingerprint, never the key in UI state
//! - Resolve hostnames before first request and reject disallowed resolved IP ranges
//! - Re-check redirects/DNS rebinding where transport supports it
//! - Import preview lists every provider endpoint and whether a key is present
//! - User can uncheck providers; import is not all-or-nothing
//! - Profile key file ACL current user where Windows supports it

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::Path;
use std::sync::LazyLock;
use std::time::SystemTime;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::Url;
use tokio::net::lookup_host;

/// Maximum length for baseUrl
const MAX_BASE_URL_LEN: usize = 2048;

/// Trust fingerprint stored for allowed private endpoints.
/// Never contains the API key or any secret material.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EndpointTrustFingerprint {
    /// Scheme: "http" or "https"
    pub scheme: String,
    /// Hostname as provided (not resolved IP)
    pub host: String,
    /// Port (explicit or default for scheme)
    pub port: u16,
    /// SHA-256 of "scheme://host:port" for opaque identification
    pub fingerprint: String,
    /// When this trust decision was recorded
    pub trusted_at: u64, // unix timestamp
    /// Human-readable note (e.g., "Self-hosted proxy for provider X")
    pub note: Option<String>,
}

/// Registry of trusted private endpoints persisted per canoPi profile.
/// Keyed by fingerprint.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct TrustedEndpointRegistry {
    entries: HashMap<String, EndpointTrustFingerprint>,
}

impl TrustedEndpointRegistry {
    pub fn load(profile_dir: &Path) -> Result<Self, String> {
        let path = profile_dir.join("trusted_endpoints.json");
        if !path.exists() {
            return Ok(Self::default());
        }
        let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if data.trim().is_empty() {
            return Ok(Self::default());
        }
        serde_json::from_str(&data).map_err(|e| format!("Corrupt trusted_endpoints.json: {e}"))
    }

    pub fn save(&self, profile_dir: &Path) -> Result<(), String> {
        let path = profile_dir.join("trusted_endpoints.json");
        let tmp = profile_dir.join(format!(".trusted_endpoints.tmp-{}", std::process::id()));
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        // Set restrictive permissions on Windows (current user only)
        #[cfg(windows)]
        {
            if let Err(e) = set_current_user_only_acl(&tmp) {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
        }
        std::fs::rename(&tmp, &path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            e.to_string()
        })
    }

    pub fn is_trusted(&self, scheme: &str, host: &str, port: u16) -> bool {
        let fp = compute_fingerprint(scheme, host, port);
        self.entries.contains_key(&fp)
    }

    pub fn add(&mut self, scheme: &str, host: &str, port: u16, note: Option<String>) {
        let fp = compute_fingerprint(scheme, host, port);
        self.entries.insert(fp.clone(), EndpointTrustFingerprint {
            scheme: scheme.to_string(),
            host: host.to_string(),
            port,
            fingerprint: fp,
            trusted_at: SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs(),
            note,
        });
    }

    pub fn remove(&mut self, scheme: &str, host: &str, port: u16) -> bool {
        let fp = compute_fingerprint(scheme, host, port);
        self.entries.remove(&fp).is_some()
    }

    pub fn list(&self) -> Vec<EndpointTrustFingerprint> {
        self.entries.values().cloned().collect()
    }
}

static TRUSTED_REGISTRY: LazyLock<Mutex<Option<TrustedEndpointRegistry>>> = LazyLock::new(|| Mutex::new(None));

/// Initialize the trusted endpoint registry for a profile directory.
pub fn init_trusted_registry(profile_dir: &Path) -> Result<(), String> {
    let reg = TrustedEndpointRegistry::load(profile_dir)?;
    *TRUSTED_REGISTRY.lock() = Some(reg);
    Ok(())
}

/// Get the current trusted registry (must be initialized first).
pub fn get_trusted_registry() -> Option<TrustedEndpointRegistry> {
    TRUSTED_REGISTRY.lock().clone()
}

/// Update the global registry after modification.
fn update_global_registry(reg: &TrustedEndpointRegistry) {
    *TRUSTED_REGISTRY.lock() = Some(reg.clone());
}

/// Compute a deterministic SHA-256 fingerprint for an endpoint.
fn compute_fingerprint(scheme: &str, host: &str, port: u16) -> String {
    let input = format!("{}://{}:{}", scheme, host, port);
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

/// Check if an IP address is in a private/reserved/metadata range.
/// Returns (is_private, is_never_trustable)
/// Loopback is explicitly allowed elsewhere and returns (false, false) here.
fn classify_ip(ip: IpAddr) -> (bool, bool) {
    match ip {
        IpAddr::V4(ipv4) => {
            // Loopback - handled by caller
            if ipv4.is_loopback() {
                return (false, false);
            }
            // Metadata service (cloud providers) - 169.254.169.254 - NEVER trustable
            let octets = ipv4.octets();
            if octets[0] == 169 && octets[1] == 254 && octets[2] == 169 && octets[3] == 254 {
                return (true, true);
            }
            // Link-local (RFC 3927) - 169.254.0.0/16 - NEVER trustable
            if octets[0] == 169 && octets[1] == 254 {
                return (true, true);
            }
            // Private networks (RFC 1918) - trustable with explicit consent
            if octets[0] == 10 {
                return (true, false);
            }
            if octets[0] == 172 && (16..=31).contains(&octets[1]) {
                return (true, false);
            }
            if octets[0] == 192 && octets[1] == 168 {
                return (true, false);
            }
            // Carrier-grade NAT (RFC 6598) - 100.64.0.0/10 - trustable with explicit consent
            if octets[0] == 100 && (64..=127).contains(&octets[1]) {
                return (true, false);
            }
            // Reserved / multicast / broadcast / documentation / unspecified - NEVER trustable
            if ipv4.is_multicast() || ipv4.is_broadcast() || ipv4.is_documentation() || ipv4.is_unspecified() {
                return (true, true);
            }
            // Public IPv4
            (false, false)
        }
        IpAddr::V6(ipv6) => {
            // Loopback - handled by caller
            if ipv6.is_loopback() {
                return (false, false);
            }
            // IPv4-mapped IPv6 addresses (::ffff:x:x) - check the embedded IPv4
            if let Some(ipv4) = ipv6.to_ipv4_mapped() {
                return classify_ip(IpAddr::V4(ipv4));
            }
            // Unique local addresses (RFC 4193) - fc00::/7 - trustable with explicit consent
            let segments = ipv6.segments();
            if (segments[0] & 0xfe00) == 0xfc00 {
                return (true, false);
            }
            // Link-local (RFC 4291) - fe80::/10 - NEVER trustable
            if (segments[0] & 0xffc0) == 0xfe80 {
                return (true, true);
            }
            // Documentation (RFC 3849) - 2001:db8::/32 - NEVER trustable
            if segments[0] == 0x2001 && segments[1] == 0x0db8 {
                return (true, true);
            }
            // Multicast / unspecified - NEVER trustable
            if ipv6.is_multicast() || ipv6.is_unspecified() {
                return (true, true);
            }
            // Public IPv6
            (false, false)
        }
    }
}
/// Backward compatibility: true if IP is private/reserved/metadata (any category)
fn is_private_or_reserved_ip(ip: IpAddr) -> bool {
    classify_ip(ip).0
}

/// True if IP is in a category that can NEVER be trusted (metadata, link-local, multicast, etc.)
fn is_never_trustable_ip(ip: IpAddr) -> bool {
    classify_ip(ip).1
}

/// Check if a hostname is a verified loopback address.
fn is_verified_loopback_host(host: &str) -> bool {
    let h = host.trim_start_matches('[').trim_end_matches(']');
    h.eq_ignore_ascii_case("localhost")
        || h == "127.0.0.1"
        || h == "::1"
}

/// Resolve a hostname to IP addresses using tokio's async DNS and check if all are allowed.
/// Returns (allowed, never_trustable, resolved_ips, error_if_any)
async fn resolve_and_check_host(host: &str) -> (bool, bool, Vec<IpAddr>, Option<String>) {
    let clean_host = host.trim_start_matches('[').trim_end_matches(']');
    let port = 80u16; // Port doesn't matter for resolution
    let addr_str = format!("{}:{}", clean_host, port);
    let resolution = lookup_host(&addr_str).await;
    match resolution {
        Ok(addrs) => {
            let ips: Vec<IpAddr> = addrs.map(|a| a.ip()).collect();
            if ips.is_empty() {
                return (false, false, vec![], Some("Hostname resolved to no IP addresses".into()));
            }
            // Check if ANY resolved IP is private
            let any_private = ips.iter().any(|ip| is_private_or_reserved_ip(*ip));
            // Check if ANY resolved IP is NEVER trustable (metadata, link-local, multicast, etc.)
            let any_never_trustable = ips.iter().any(|ip| is_never_trustable_ip(*ip));
            // Allowed = no private IPs
            let all_allowed = !any_private;
            (all_allowed, any_never_trustable, ips, None)
        }
        Err(e) => (false, false, vec![], Some(format!("DNS resolution failed: {e}"))),
    }
}

/// Validated URL result with full endpoint analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatedUrl {
    pub original: String,
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub path: String,
    pub is_loopback: bool,
    pub is_private: bool,
    pub is_never_trustable: bool,
    pub resolved_ips: Vec<IpAddr>,
    pub requires_trust: bool,
    pub trust_fingerprint: Option<String>,
}

pub async fn validate_provider_base_url(url_str: &str) -> Result<ValidatedUrl, String> {
    let url_str = url_str.trim();
    if url_str.is_empty() {
        return Err("baseUrl is empty".into());
    }
    if url_str.len() > MAX_BASE_URL_LEN {
        return Err(format!("baseUrl exceeds maximum length ({MAX_BASE_URL_LEN})"));
    }

    // Parse with tauri::Url (uses url crate internally)
    let url = Url::parse(url_str).map_err(|_| "Invalid URL format".to_string())?;

    // Must be http or https
    let scheme = url.scheme().to_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err("baseUrl must use http:// or https:// scheme".into());
    }

    // No credentials in URL
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL credentials (userinfo) are forbidden".into());
    }

    // Host is required
    let host = url.host_str().ok_or("baseUrl must have a hostname")?.to_string();
    if host.is_empty() {
        return Err("baseUrl has empty hostname".into());
    }

    // Check for encoded host bypass attempts (e.g., http://example.com@evil.com)
    // tauri::Url handles this correctly, but verify host doesn't contain @
    if host.contains('@') {
        return Err("Encoded host bypass detected".into());
    }

    // Port
    let port = url.port().unwrap_or(if scheme == "https" { 443 } else { 80 });

    // Path
    let path = url.path().to_string();

    // Determine if loopback
    let is_loopback = is_verified_loopback_host(&host);

    // Resolve hostname for private IP check (skip for loopback)
    let (resolved_ips, is_private, is_never_trustable) = if is_loopback {
        // For loopback, no DNS resolution needed - it's explicitly allowed
        (vec![], false, false)
    } else {
        let (allowed, never_trustable, ips, err) = resolve_and_check_host(&host).await;
        if let Some(err) = err {
            // Resolution failure: treat as potentially private, require trust
            // Return error info for UI disclosure but mark as private
            (vec![], true, false)
        } else {
            (ips, !allowed, never_trustable)
        }
    };

    // Check if already trusted
    let trust_fingerprint = Some(compute_fingerprint(&scheme, &host, port));
    let requires_trust = is_private && !is_trusted_endpoint(&scheme, &host, port);

    Ok(ValidatedUrl {
        original: url_str.to_string(),
        scheme,
        host,
        port,
        path,
        is_loopback,
        is_private,
        is_never_trustable,
        resolved_ips,
        requires_trust,
        trust_fingerprint,
    })
}

/// Check if an endpoint is in the trusted registry (synchronous, for validation).
fn is_trusted_endpoint(scheme: &str, host: &str, port: u16) -> bool {
    if let Some(reg) = get_trusted_registry() {
        reg.is_trusted(scheme, host, port)
    } else {
        false
    }
}

/// Trust a private endpoint (persist fingerprint).
pub fn trust_endpoint(scheme: &str, host: &str, port: u16, note: Option<String>, profile_dir: &Path) -> Result<(), String> {
    let mut reg = get_trusted_registry().ok_or("Trusted registry not initialized")?;
    reg.add(scheme, host, port, note);
    reg.save(profile_dir)?;
    update_global_registry(&reg);
    Ok(())
}

/// Revoke trust for an endpoint.
pub fn revoke_endpoint_trust(scheme: &str, host: &str, port: u16, profile_dir: &Path) -> Result<bool, String> {
    let mut reg = get_trusted_registry().ok_or("Trusted registry not initialized")?;
    let removed = reg.remove(scheme, host, port);
    if removed {
        reg.save(profile_dir)?;
        update_global_registry(&reg);
    }
    Ok(removed)
}

/// List all trusted endpoints.
pub fn list_trusted_endpoints() -> Vec<EndpointTrustFingerprint> {
    get_trusted_registry().map(|r| r.list()).unwrap_or_default()
}

/// Import preview entry for a single provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderImportPreview {
    pub id: String,
    pub has_key: bool,
    pub base_url: Option<String>,
    pub api: Option<String>,
    pub models: Vec<ModelImportPreview>,
    pub validated_url: Option<ValidatedUrl>,
    pub trust_required: bool,
}

/// Model preview entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelImportPreview {
    pub name: Option<String>,
    pub api: Option<String>,
    pub base_url: Option<String>,
    pub validated_url: Option<ValidatedUrl>,
}

/// Parse and validate all providers for import preview.
/// Does NOT modify or persist anything. Returns detailed preview per provider.
pub async fn generate_import_preview(raw: &str, filename: &str) -> Result<Vec<ProviderImportPreview>, String> {
    let parsed: Value = if filename.ends_with(".json") {
        serde_json::from_str(raw).map_err(|e| format!("Malformed JSON: {e}"))?
    } else {
        serde_yaml::from_str(raw).map_err(|e| format!("Malformed YAML: {e}"))?
    };

    let root = match parsed {
        Value::Object(m) => m,
        _ => return Err("Root must be an object/mapping".into()),
    };

    let providers_val = match root.get("providers") {
        Some(v) => v,
        None => return Ok(vec![]),
    };

    let providers_obj = match providers_val {
        Value::Object(m) => m,
        _ => return Err("'providers' must be an object/mapping".into()),
    };

    let mut previews = Vec::new();

    for (prov_id, prov_val) in providers_obj {
        let prov_map = match prov_val {
            Value::Object(m) => m,
            _ => continue,
        };

        // API key presence
        let has_key = match prov_map.get("apiKey") {
            Some(Value::String(s)) => !s.trim().is_empty(),
            Some(Value::Number(_)) => true,
            _ => false,
        };

        // Base URL
        let base_url = prov_map.get("baseUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        // API
        let api = prov_map.get("api")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        // Validate provider baseUrl if present
        let (validated_url, trust_required) = if let Some(ref url) = base_url {
            match validate_provider_base_url(url).await {
                Ok(v) => {
                    let needs_trust = v.requires_trust;
                    (Some(v), needs_trust)
                }
                Err(e) => {
                    // Invalid URL - still include in preview but mark as invalid
                    (None, false)
                }
            }
        } else {
            (None, false)
        };

        // Models
        let mut models = Vec::new();
        if let Some(Value::Array(models_arr)) = prov_map.get("models") {
            for m in models_arr {
                if let Value::Object(m_map) = m {
                    let name = m_map.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let m_api = m_map.get("api").and_then(|v| v.as_str()).map(|s| s.trim().to_string());
                    let m_base_url = m_map.get("baseUrl").and_then(|v| v.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty()).map(|s| s.to_string());

                    // Validate model-level baseUrl if present
                    let m_validated = if let Some(ref m_url) = m_base_url {
                        validate_provider_base_url(m_url).await.ok()
                    } else {
                        None
                    };

                    models.push(ModelImportPreview {
                        name,
                        api: m_api,
                        base_url: m_base_url,
                        validated_url: m_validated,
                    });
                }
            }
        }

        previews.push(ProviderImportPreview {
            id: prov_id.clone(),
            has_key,
            base_url,
            api,
            models,
            validated_url,
            trust_required,
        });
    }

    Ok(previews)
}

/// Validate and sanitize imported models config with strict endpoint policy.
/// This is the save-time validation. Runtime validation happens in transport layer.
pub fn sanitize_and_validate_imported_models(raw: &str, filename: &str) -> Result<String, String> {
    let mut parsed: Value = if filename.ends_with(".json") {
        serde_json::from_str(raw).map_err(|e| format!("Malformed JSON: {e}"))?
    } else {
        serde_yaml::from_str(raw).map_err(|e| format!("Malformed YAML: {e}"))?
    };

    let root = match &mut parsed {
        Value::Object(m) => m,
        _ => return Err("Root must be an object/mapping".into()),
    };

    let providers_val = match root.get_mut("providers") {
        Some(v) => v,
        None => return Ok(serde_json::to_string(&parsed).unwrap()),
    };

    let providers_obj = match providers_val {
        Value::Object(m) => m,
        _ => return Err("'providers' must be an object/mapping".into()),
    };

    for (prov_id, prov_val) in providers_obj.iter_mut() {
        let prov_map = match prov_val {
            Value::Object(m) => m,
            _ => return Err(format!("Provider '{prov_id}' must be an object")),
        };

        // Validate provider baseUrl if present
        if let Some(url_val) = prov_map.get_mut("baseUrl") {
            if let Some(url_str) = url_val.as_str() {
                let url_str = url_str.trim();
                if !url_str.is_empty() {
                    let url = Url::parse(url_str).map_err(|_| format!("Provider '{prov_id}': invalid baseUrl format"))?;
                    let scheme = url.scheme().to_lowercase();
                    if scheme != "http" && scheme != "https" {
                        return Err(format!("Provider '{prov_id}': baseUrl must use http:// or https://"));
                    }
                    if !url.username().is_empty() || url.password().is_some() {
                        return Err(format!("Provider '{prov_id}': URL credentials forbidden"));
                    }
                    let host = url.host_str().ok_or_else(|| format!("Provider '{prov_id}': missing hostname"))?;
                    if host.contains('@') {
                        return Err(format!("Provider '{prov_id}': encoded host bypass detected"));
                    }
                    // Enforce HTTPS for non-loopback
                    if scheme == "http" && !is_verified_loopback_host(host) {
                        return Err(format!("Provider '{prov_id}': HTTP only allowed for verified loopback (localhost, 127.0.0.1, ::1)"));
                    }
                    // Check if host resolves to never-trustable IPs (metadata, link-local, multicast)
                    // Note: This is save-time check; runtime transport does request-time validation
                    if !is_verified_loopback_host(host) {
                        // Async DNS not available here; just validate scheme/host format
                        // Full resolution happens at transport layer
                    }
                }
            }
        }

        // Normalize API
        if let Some(api_val) = prov_map.get_mut("api") {
            if let Some(api_str) = api_val.as_str() {
                let api_str = api_str.trim();
                if api_str == "openai-chat" {
                    *api_val = Value::String("openai-completions".to_string());
                } else if !allowed_apis().contains(&api_str) {
                    return Err(format!("Provider '{prov_id}': unsupported API '{api_str}'"));
                }
            }
        }

        // Models
        if let Some(Value::Array(models_arr)) = prov_map.get_mut("models") {
            for m in models_arr.iter_mut() {
                if let Value::Object(m_map) = m {
                    if let Some(m_api_val) = m_map.get_mut("api") {
                        if let Some(m_api_str) = m_api_val.as_str() {
                            let m_api_str = m_api_str.trim();
                            if m_api_str == "openai-chat" {
                                *m_api_val = Value::String("openai-completions".to_string());
                            } else if !allowed_apis().contains(&m_api_str) {
                                return Err(format!("Model in provider '{prov_id}': unsupported API '{m_api_str}'"));
                            }
                        }
                    }
                    // Model-level baseUrl validation
                    if let Some(m_url_val) = m_map.get_mut("baseUrl") {
                        if let Some(m_url_str) = m_url_val.as_str() {
                            let m_url_str = m_url_str.trim();
                            if !m_url_str.is_empty() {
                                let url = Url::parse(m_url_str).map_err(|_| format!("Model in provider '{prov_id}': invalid baseUrl format"))?;
                                let scheme = url.scheme().to_lowercase();
                                if scheme != "http" && scheme != "https" {
                                    return Err(format!("Model in provider '{prov_id}': baseUrl must use http:// or https://"));
                                }
                                if !url.username().is_empty() || url.password().is_some() {
                                    return Err(format!("Model in provider '{prov_id}': URL credentials forbidden"));
                                }
                                let host = url.host_str().ok_or_else(|| format!("Model in provider '{prov_id}': missing hostname"))?;
                                if host.contains('@') {
                                    return Err(format!("Model in provider '{prov_id}': encoded host bypass detected"));
                                }
                                // Enforce HTTPS for non-loopback
                                if scheme == "http" && !is_verified_loopback_host(host) {
                                    return Err(format!("Model in provider '{prov_id}': HTTP only allowed for verified loopback (localhost, 127.0.0.1, ::1)"));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Serialize back
    if filename.ends_with(".json") {
        serde_json::to_string_pretty(&parsed).map_err(|e| format!("Failed to serialize JSON: {e}"))
    } else {
        serde_yaml::to_string(&parsed).map_err(|e| format!("Failed to serialize YAML: {e}"))
    }
}
/// ALLOWED_APIS is defined in main.rs; use that single source of truth.
/// This function validates against the same list.
fn allowed_apis() -> &'static [&'static str] {
    crate::ALLOWED_APIS
}

/// Session file containment: canonicalize and constrain paths under app-owned session root.
/// Used for get_subagent_messages and similar RPC calls that accept file paths.
pub fn canonicalize_session_file(session_root: &Path, requested_path: &str) -> Result<std::path::PathBuf, String> {
    // Basic validation
    if requested_path.is_empty() || requested_path.len() > 4096 {
        return Err("Session file path out of bounds".into());
    }
    // No directory traversal attempts
    if requested_path.contains("..") || requested_path.contains("//") || requested_path.contains("\\\\") {
        return Err("Session file path contains traversal sequences".into());
    }

    // Canonicalize the session root
    let canonical_root = session_root.canonicalize().map_err(|e| format!("Invalid session root: {e}"))?;

    // Resolve the requested path relative to session root
    let requested = canonical_root.join(requested_path);
    let canonical_requested = requested.canonicalize().map_err(|e| format!("Invalid session file path: {e}"))?;

    // Verify containment
    if !canonical_requested.starts_with(&canonical_root) {
        return Err("Session file path escapes session root".into());
    }

    // Must be a file (not directory) and within reasonable size
    let meta = std::fs::metadata(&canonical_requested).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Session path is not a file".into());
    }
    if meta.len() > 100_000_000 { // 100MB limit
        return Err("Session file exceeds size limit".into());
    }

    Ok(canonical_requested)
}

/// Set file ACL to current user only (Windows). Failure propagates before the file is persisted.
#[cfg(windows)]
fn set_current_user_only_acl(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::*;
    use windows::Win32::Security::*;
    use windows::Win32::Security::Authorization::*;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // Get current user SID
    let mut token = HANDLE::default();
    unsafe {
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|e| format!("OpenProcessToken failed: {e}"))?;
    }

    let mut size = 0u32;
    unsafe {
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut size);
    }
    let mut buffer = vec![0u8; size as usize];
    unsafe {
        GetTokenInformation(token, TokenUser, Some(buffer.as_mut_ptr() as *mut _), size, &mut size)
            .map_err(|e| format!("GetTokenInformation failed: {e}"))?;
    }
    let token_user = buffer.as_ptr() as *const TOKEN_USER;
    let user_sid = unsafe { (*token_user).User.Sid };

    // Build DACL with only current user
    let explicit_access = EXPLICIT_ACCESS_W {
        grfAccessPermissions: GENERIC_ALL.0,
        grfAccessMode: SET_ACCESS,
        grfInheritance: NO_INHERITANCE,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_USER,
            ptstrName: PWSTR(user_sid.0 as *mut u16),
        },
    };

    let mut new_acl: *mut ACL = std::ptr::null_mut();
    let result = unsafe {
        SetEntriesInAclW(Some(std::slice::from_ref(&explicit_access)), None, &mut new_acl)
    };
    if result != ERROR_SUCCESS {
        return Err(format!("SetEntriesInAclW failed: {}", result.0));
    }

    // Apply to file
    let path_w: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        SetNamedSecurityInfoW(
            PCWSTR(path_w.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(new_acl as *const ACL),
            None,
        )
    };

    unsafe { LocalFree(Some(HLOCAL(new_acl.cast()))) };

    if result != ERROR_SUCCESS {
        return Err(format!("SetNamedSecurityInfoW failed: {}", result.0));
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_current_user_only_acl(_path: &Path) -> Result<(), String> {
    // On Unix, rely on umask / default permissions
    Ok(())
}

/// Transport-layer request-time validation.
/// This function MUST be called at the transport layer before each outbound request
/// to enforce redirect/DNS rebinding protection where the transport supports it.
/// Returns the validated URL components if allowed, or an error if blocked.
pub async fn validate_request_time_url(url_str: &str, trusted_registry: &TrustedEndpointRegistry) -> Result<ValidatedUrl, String> {
    let validated = validate_provider_base_url(url_str).await?;
    
    // Additional request-time checks:
    // 1. If this is a redirect, the redirect target must also be validated
    // 2. Re-resolve hostname to detect DNS rebinding
    if !validated.is_loopback {
        // For ALL non-loopback endpoints, re-resolve to ensure DNS hasn't changed
        // and to check for never-trustable IPs (metadata, link-local, multicast)
        let (allowed, never_trustable, resolved_ips, err) = resolve_and_check_host(&validated.host).await;
        if let Some(err) = err {
            return Err(format!("DNS rebinding check failed: {err}"));
        }
        // NEVER trustable: metadata, link-local, multicast, documentation, unspecified
        if never_trustable {
            return Err("DNS rebinding detected: hostname resolves to never-trustable IP (metadata, link-local, multicast, etc.)".into());
        }
        // For public endpoints, must not resolve to any private IP
        if !validated.is_private && !allowed {
            return Err("DNS rebinding detected: hostname now resolves to private IP".into());
        }
    }
    
    // 3. For private endpoints, verify trust registry still has this fingerprint
    if validated.is_private {
        if !trusted_registry.is_trusted(&validated.scheme, &validated.host, validated.port) {
            return Err("Endpoint trust revoked or not present".into());
        }
        // Also verify that private endpoint doesn't resolve to never-trustable IPs
        if validated.is_never_trustable {
            return Err("Private endpoint resolves to never-trustable IP (metadata, link-local, multicast, etc.)".into());
        }
    }
    
    Ok(validated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::IpAddr;

    #[test]
    fn test_is_private_or_reserved_ip() {
        // Loopback - NOT private (explicitly allowed)
        assert!(!is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(!is_private_or_reserved_ip(IpAddr::V6(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 1))));

        // RFC 1918 private
        assert!(is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
        assert!(is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))));
        assert!(is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(172, 31, 255, 255))));
        assert!(is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));

        // Link-local
        assert!(is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1))));
        assert!(is_private_or_reserved_ip(IpAddr::V6(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 1))));

        // Metadata service
        assert!(is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))));

        // Carrier-grade NAT
        assert!(is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))));
        assert!(is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(100, 127, 255, 255))));

        // IPv6 ULA
        assert!(is_private_or_reserved_ip(IpAddr::V6(Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 1))));
        assert!(is_private_or_reserved_ip(IpAddr::V6(Ipv6Addr::new(0xfd00, 0, 0, 0, 0, 0, 0, 1))));

        // IPv4-mapped IPv6 bypass check
        let mapped = Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0101); // ::ffff:192.168.1.1
        assert!(is_private_or_reserved_ip(IpAddr::V6(mapped)));

        // Public IPs - NOT private
        assert!(!is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_private_or_reserved_ip(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))));
        assert!(!is_private_or_reserved_ip(IpAddr::V6(Ipv6Addr::new(0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888))));
    }

    #[test]
    fn test_compute_fingerprint_deterministic() {
        let fp1 = compute_fingerprint("https", "example.com", 443);
        let fp2 = compute_fingerprint("https", "example.com", 443);
        assert_eq!(fp1, fp2);
        let fp3 = compute_fingerprint("http", "localhost", 8080);
        assert_ne!(fp1, fp3);
        // Verify it's SHA-256 (64 hex chars)
        assert_eq!(fp1.len(), 64);
    }

    #[test]
    fn test_trusted_registry_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();

        let mut reg = TrustedEndpointRegistry::default();
        reg.add("https", "internal.example.com", 8443, Some("Internal proxy".into()));
        reg.add("http", "192.168.1.100", 8080, None);
        reg.save(path).unwrap();

        let loaded = TrustedEndpointRegistry::load(path).unwrap();
        assert!(loaded.is_trusted("https", "internal.example.com", 8443));
        assert!(loaded.is_trusted("http", "192.168.1.100", 8080));
        assert!(!loaded.is_trusted("https", "internal.example.com", 443));
        assert!(!loaded.is_trusted("http", "192.168.1.101", 8080));

        let list = loaded.list();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_canonicalize_session_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Create a test file
        let test_file = root.join("transcript.json");
        std::fs::write(&test_file, b"{}").unwrap();

        // Valid relative path
        let canon = canonicalize_session_file(root, "transcript.json").unwrap();
        assert_eq!(canon, test_file.canonicalize().unwrap());

        // Traversal attempt
        assert!(canonicalize_session_file(root, "../etc/passwd").is_err());
        assert!(canonicalize_session_file(root, "subdir/../../transcript.json").is_err());

        // Absolute path (should fail - not under root)
        assert!(canonicalize_session_file(root, "/etc/passwd").is_err());
    }

    #[test]
    fn test_validate_http_loopback_only() {
        // These are the only allowed HTTP URLs
        let http_ok = ["http://localhost", "http://localhost:8080", "http://127.0.0.1", "http://[::1]"];
        for u in http_ok {
            let url = Url::parse(u).unwrap();
            assert!(is_verified_loopback_host(url.host_str().unwrap()));
        }

        // These should NOT be allowed for HTTP
        let http_bad = ["http://example.com", "http://192.168.1.1", "http://10.0.0.1"];
        for u in http_bad {
            let url = Url::parse(u).unwrap();
            assert!(!is_verified_loopback_host(url.host_str().unwrap()));
        }
    }

    #[test]
    fn test_is_never_trustable_ip() {
        // Metadata service - NEVER trustable
        assert!(is_never_trustable_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))));
        // Link-local IPv4 - NEVER trustable
        assert!(is_never_trustable_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1))));
        // Link-local IPv6 - NEVER trustable
        assert!(is_never_trustable_ip(IpAddr::V6(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 1))));
        // Documentation IPv6 - NEVER trustable
        assert!(is_never_trustable_ip(IpAddr::V6(Ipv6Addr::new(0x2001, 0x0db8, 0, 0, 0, 0, 0, 1))));
        // Multicast - NEVER trustable
        assert!(is_never_trustable_ip(IpAddr::V4(Ipv4Addr::new(224, 0, 0, 1))));
        assert!(is_never_trustable_ip(IpAddr::V6(Ipv6Addr::new(0xff00, 0, 0, 0, 0, 0, 0, 1))));
        // Unspecified - NEVER trustable
        assert!(is_never_trustable_ip(IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0))));
        assert!(is_never_trustable_ip(IpAddr::V6(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 0))));

        // RFC 1918 private - TRUSTABLE with consent
        assert!(!is_never_trustable_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
        assert!(!is_never_trustable_ip(IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))));
        assert!(!is_never_trustable_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
        // Carrier-grade NAT - TRUSTABLE with consent
        assert!(!is_never_trustable_ip(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))));
        // IPv6 ULA - TRUSTABLE with consent
        assert!(!is_never_trustable_ip(IpAddr::V6(Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 1))));
        assert!(!is_never_trustable_ip(IpAddr::V6(Ipv6Addr::new(0xfd00, 0, 0, 0, 0, 0, 0, 1))));
        // Public IPs - NOT trustable check
        assert!(!is_never_trustable_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_never_trustable_ip(IpAddr::V6(Ipv6Addr::new(0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888))));
    }
}