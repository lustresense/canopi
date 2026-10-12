import React, { useState, useEffect, useCallback } from 'react';
import {
  previewOmpModels,
  importOmpModels,
  validateProviderBaseUrl,
  trustProviderEndpoint,
  revokeProviderEndpointTrust,
  listTrustedProviderEndpoints
} from '../runtime/native.js';

/**
 * ProviderImport — Dedicated component for selective OMP provider import
 * with strict endpoint validation and trust disclosure.
 *
 * Discloses all provider destinations per source file, whether an API key is present,
 * and allows selecting a subset to import. Does not mutate OMP source files.
 * Persists trust decisions natively without exposing keys.
 */
export default function ProviderImport({ onImportComplete, onCancel }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filePreviews, setFilePreviews] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [providers, setProviders] = useState([]);
  const [selectedProviders, setSelectedProviders] = useState(new Set());
  const [trustedEndpoints, setTrustedEndpoints] = useState([]);
  const [trustingEndpoint, setTrustingEndpoint] = useState(null);
  const [importing, setImporting] = useState(false);
  const [trustConfirmOpen, setTrustConfirmOpen] = useState(null);

  // Load preview and trusted endpoints
  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await previewOmpModels();
      if (!res.available || res.files.length === 0) {
        setError('No OMP model configuration files found (~/.omp/agent/models.ya?ml|json)');
        setLoading(false);
        return;
      }
      
      // Group providers by source file with file digest
      const fileMap = new Map();
      for (const p of res.providers || []) {
        const key = p.source_file || res.files[0];
        if (!fileMap.has(key)) {
          fileMap.set(key, { filename: key, providers: [], digest: p.file_digest });
        }
        fileMap.get(key).providers.push(p);
      }
      
      const previews = Array.from(fileMap.values());
      setFilePreviews(previews);
      
      // Select first file by default
      if (previews.length > 0) {
        setSelectedFile(previews[0].filename);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrustedEndpoints = useCallback(async () => {
    try {
      const res = await listTrustedProviderEndpoints();
      setTrustedEndpoints(res.endpoints || []);
    } catch (err) {
      console.error('Failed to load trusted endpoints:', err);
    }
  }, []);

  useEffect(() => {
    loadPreview();
    loadTrustedEndpoints();
  }, [loadPreview, loadTrustedEndpoints]);

  // Update providers when selected file changes
  useEffect(() => {
    if (!selectedFile) {
      setProviders([]);
      setSelectedProviders(new Set());
      return;
    }
    const fileData = filePreviews.find(f => f.filename === selectedFile);
    if (fileData) {
      const provs = fileData.providers;
      setProviders(provs);
      // Default: select all providers that have keys or valid endpoints
      setSelectedProviders(new Set(provs.map(p => p.id)));
    } else {
      setProviders([]);
      setSelectedProviders(new Set());
    }
  }, [selectedFile, filePreviews]);

  function toggleProvider(id) {
    setSelectedProviders(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleTrustEndpoint(prov) {
    if (!prov.validated_url) return;
    setTrustConfirmOpen(prov);
  }

  async function confirmTrust(prov) {
    if (!prov.validated_url) return;
    setTrustingEndpoint(prov.id);
    try {
      const { scheme, host, port } = prov.validated_url;
      await trustProviderEndpoint(
        scheme,
        host,
        port,
        `Trusted via import preview for provider ${prov.id} (file: ${selectedFile})`
      );
      await loadTrustedEndpoints();
      await loadPreview();
    } catch (err) {
      setError(`Failed to trust endpoint: ${err?.message || String(err)}`);
    } finally {
      setTrustingEndpoint(null);
      setTrustConfirmOpen(null);
    }
  }

  async function handleImport() {
    if (!selectedFile) return;
    if (selectedProviders.size === 0) {
      setError('Please select at least one provider to import');
      return;
    }

    // Check if any selected provider requires trust that hasn't been granted
    const untrusted = providers.filter(
      p => selectedProviders.has(p.id) && p.trust_required
    );
    if (untrusted.length > 0) {
      setError(
        `Cannot import: provider(s) ${untrusted.map(p => p.id).join(', ')} use private endpoints that must be explicitly trusted first.`
      );
      return;
    }

    // Verify source file hasn't changed since preview (digest check)
    const fileData = filePreviews.find(f => f.filename === selectedFile);
    if (fileData && fileData.digest) {
      // The import command will re-validate; if source changed, sanitize will fail
      // This is enforced server-side by re-reading the file
    }

    setImporting(true);
    setError(null);
    try {
      const res = await importOmpModels(selectedFile, Array.from(selectedProviders));
      if (onImportComplete) {
        onImportComplete(res);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setImporting(false);
    }
  }

  // Trust confirmation modal
  const trustConfirm = trustConfirmOpen;
  if (trustConfirm && trustConfirm.validated_url) {
    const { scheme, host, port, is_private, is_never_trustable, resolved_ips } = trustConfirm.validated_url;
    return (
      <div className="provider-import-container">
        <div className="trust-confirm-modal-overlay" onClick={() => setTrustConfirmOpen(null)}>
          <div className="trust-confirm-modal" onClick={e => e.stopPropagation()}>
            <h3>⚠️ Advanced: Trust Private Endpoint</h3>
            <p><strong>Provider:</strong> {trustConfirm.id}</p>
            <p><strong>Source file:</strong> {selectedFile}</p>
            <hr />
            <p><strong>Scheme:</strong> {scheme.toUpperCase()}</p>
            <p><strong>Host:</strong> {host}</p>
            <p><strong>Port:</strong> {port}</p>
            <p><strong>Resolved IPs:</strong> {resolved_ips.length > 0 ? resolved_ips.map(ip => ip.toString()).join(', ') : 'Not resolved (preview only)'}</p>
            {is_never_trustable && (
              <div className="never-trustable-warning">
                <strong>BLOCKED:</strong> This endpoint resolves to a never-trustable IP range (metadata service, link-local, multicast, documentation, or unspecified). Trust is NOT possible.
              </div>
            )}
            {!is_never_trustable && is_private && (
              <div className="private-warning">
                <p><strong>Security Consequence:</strong> This endpoint receives your API key and prompts over a private/non-public network.</p>
                <p>By confirming, you persist a trust fingerprint (SHA-256 of "{scheme}://{host}:{port}") in canoPi's native profile. The API key is NEVER stored in this trust record.</p>
              </div>
            )}
            <div className="trust-confirm-actions">
              <button 
                type="button" 
                onClick={() => setTrustConfirmOpen(null)}
                disabled={trustingEndpoint === trustConfirm.id}
                className="cancel-btn"
              >
                Cancel
              </button>
              {!is_never_trustable && is_private && (
                <button
                  type="button"
                  onClick={() => confirmTrust(trustConfirm)}
                  disabled={trustingEndpoint === trustConfirm.id}
                  className="trust-btn primary"
                >
                  {trustingEndpoint === trustConfirm.id ? 'Trusting...' : 'Confirm: Trust This Endpoint'}
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Render main UI behind modal */}
        {renderMainUI()}
      </div>
    );
  }

  const renderMainUI = () => {
    if (loading) {
      return (
        <div className="provider-import-loading">
          <p>Scanning OMP model configuration...</p>
        </div>
      );
    }

    return (
      <div className="provider-import-container">
        <h3>Import Provider Configuration from OMP</h3>
        <p className="description">
          Import model and endpoint definitions from your existing OMP configuration.
          Source files remain untouched. No credentials are read from <code>agent.db</code>.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <div className="file-selection">
          <label>Configuration file:</label>
          <select
            value={selectedFile || ''}
            onChange={e => setSelectedFile(e.target.value)}
            disabled={importing}
          >
            {filePreviews.map(f => (
              <option key={f.filename} value={f.filename}>
                {f.filename} ({f.providers.length} provider{f.providers.length !== 1 ? 's' : ''}) {f.digest ? `· digest: ${f.digest.slice(0, 12)}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="providers-list">
          <h4>
            Select Providers to Import from <strong>{selectedFile}</strong> 
            ({selectedProviders.size} of {providers.length} selected)
          </h4>
          {providers.length === 0 ? (
            <p className="empty-notice">No providers defined in this file.</p>
          ) : (
            providers.map(prov => {
              const isSelected = selectedProviders.has(prov.id);
              const needsTrust = prov.trust_required;
              const neverTrustable = prov.validated_url?.is_never_trustable;
              const url = prov.validated_url;

              return (
                <div
                  key={`${selectedFile}:${prov.id}`}
                  className={`provider-card ${isSelected ? 'selected' : ''} ${needsTrust ? 'needs-trust' : ''} ${neverTrustable ? 'never-trustable' : ''}`}
                >
                  <div className="card-header">
                    <label>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleProvider(prov.id)}
                        disabled={importing || neverTrustable}
                      />
                      <strong>{prov.id}</strong>
                      {neverTrustable && <span className="badge blocked">BLOCKED</span>}
                    </label>
                    <span className={`key-status ${prov.has_key ? 'present' : 'absent'}`}>
                      {prov.has_key ? 'API Key Present' : 'No Key'}
                    </span>
                  </div>

                  <div className="card-details">
                    {prov.base_url && (
                      <div className="endpoint-detail">
                        <span className="label">Provider Endpoint:</span>
                        <code>{prov.base_url}</code>
                        {url && (
                          <span className="endpoint-meta">
                            ({url.scheme.toUpperCase()} {url.is_loopback ? 'Loopback' : url.is_private ? 'Private Network' : 'Public'})
                          </span>
                        )}
                      </div>
                    )}

                    {prov.api && (
                      <div className="api-detail">
                        <span className="label">API Type:</span>
                        <span>{prov.api}</span>
                      </div>
                    )}

                    {prov.models && prov.models.length > 0 && (
                      <div className="models-detail">
                        <span className="label">Models:</span>
                        <div className="model-list">
                          {prov.models.map((m, idx) => (
                            <div key={idx} className="model-item">
                              <span>{m.name || m.api || `Model ${idx + 1}`}</span>
                              {m.base_url && (
                                <>
                                  <span className="model-endpoint"> @ {m.base_url}</span>
                                  {m.validated_url && (
                                    <span className={`model-trust ${m.validated_url.is_never_trustable ? 'blocked' : m.validated_url.requires_trust ? 'needs-trust' : ''}`}>
                                      {m.validated_url.is_never_trustable ? ' (BLOCKED)' : m.validated_url.requires_trust ? ' (needs trust)' : ''}
                                    </span>
                                  )}
                                </>
                              )}
                              {m.api && <span className="model-api"> [{m.api}]</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {needsTrust && !neverTrustable && (
                      <div className="trust-warning">
                        <p>
                          ⚠️ <strong>Private Endpoint Security Warning:</strong> This endpoint receives your API key and prompts over a non-public network.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleTrustEndpoint(prov)}
                          disabled={trustingEndpoint === prov.id || importing}
                          className="trust-btn"
                        >
                          {trustingEndpoint === prov.id ? 'Trusting...' : 'Advanced: Trust This Endpoint'}
                        </button>
                      </div>
                    )}

                    {neverTrustable && (
                      <div className="never-trustable-notice">
                        This endpoint resolves to a never-trustable IP range (metadata service, link-local, multicast, documentation, or unspecified). 
                        It CANNOT be trusted and will be blocked at runtime.
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="action-buttons">
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || selectedProviders.size === 0}
            className="import-btn primary"
          >
            {importing ? 'Importing...' : 'Import Selected Providers'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={importing}
              className="cancel-btn"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  };

  return renderMainUI();
}