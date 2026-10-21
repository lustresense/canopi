# SPEC Template — canoPi Desktop

> Copy ke `SPEC-<feature-name>.md` untuk setiap feature baru.

---

## Feature: <Nama Feature>

### 1. Problem Statement
Apa yang mau diselesaikan?

### 2. User Stories
- As a <role>, I want <action>, so that <benefit>.

### 3. Acceptance Criteria
- [ ] Kriteria 1 (testable)
- [ ] Kriteria 2

### 4. Technical Design

#### 4.1 Data Model Changes
```rust
// Rust structs / Tauri state changes
```

```typescript
// Frontend types changes
```

#### 4.2 Tauri Commands / API
| Command | Input | Output | Permissions |
|---------|-------|--------|-------------|

#### 4.3 Frontend Changes
- Components: ...
- State: ...
- Routes: ...

#### 4.4 Migration/Compatibility
- Breaking changes: ...
- Migration: ...

### 5. Implementation Plan
- [ ] Task 1 (Rust)
- [ ] Task 2 (Frontend)
- [ ] Task 3 (Integration)

### 6. Testing Strategy
- Unit (Rust): `cargo test`
- Unit (Frontend): Vitest
- E2E: Playwright/Tauri driver

### 7. Rollout Plan
- Feature flag: ...
- Staging build: ...
- Production release: ...

### 8. Rollback Plan
- How to revert: ...
- Data migration reverse: ...
