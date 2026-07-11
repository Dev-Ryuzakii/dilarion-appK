# Project Eagle One — Device Security & Management

Roadmap for adding **device-level management (MDM/EMM)** on top of Dilarion's
existing application-level E2EE messaging. This document is the source of truth
for the "Unified Agent" work.

> **Scope & authority.** Everything here assumes **organization-owned devices**
> provisioned by the issuing authority *before* handoff, under a lawful basis
> and with the operator informed that the device is managed. Android surfaces a
> permanent "This device is managed by your organization" disclosure and there
> is no supported way to hide it. Covert management of a device the user
> personally owns is out of scope — it is also technically impossible to enroll
> as Device Owner on an already-set-up phone (see §3). Keep this deployment
> lawful and disclosed; that is what separates an EMM agent from stalkerware and
> what keeps it shippable.

---

## 1. Two layers

| Layer | Scope | Mechanism | Status |
|------|-------|-----------|--------|
| **L1 — MAM** (app security) | Messages, mission data | E2EE (RSA-2048 + AES-GCM), master-token unlock, SQLCipher at rest | Mostly built (E2EE live; SQLCipher pending) |
| **L2 — MDM/EMM** (device security) | Whole device | Device Owner / Device Admin, remote wipe, policy, boot control | This document |

Dilarion already ships the pieces the MDM layer plugs into:
- `monitoring/MonitoringForegroundService.kt` — long-running agent + remote-command intake.
- `monitoring/BootReceiver.kt` — auto-start after reboot.
- `data/api/ApiService.kt` — server channel (already carries remote commands).
- Backend `RemoteCommand` / `DeviceWipeCommand` + WebSocket delivery (Pager-proper).

---

## 2. The "Unified Agent" — and the one-owner constraint

The goal: the Dilarion app **is** the enrollment. Ship a device, operator powers
on, the app takes over device policy without them touching Android settings.

**Critical correction to the original plan:** *a device can have exactly one
Device Owner.* You cannot have both "Dilarion as Device Owner" **and** "Headwind
as Device Owner." Pick one of two architectures:

### Architecture A — Dilarion is the DPC (recommended for a true unified agent)
- Dilarion is built as a **Device Policy Controller (DPC)** and provisioned as
  **Device Owner**.
- It owns wipe/policy directly via `DevicePolicyManager` — no second agent.
- Headwind (if used at all) is only a **dashboard / C2 backend** you call over
  your own API; you do **not** install Headwind's DPC.
- Pro: one agent, one channel, no conflict. Con: you build the policy logic
  (but you only need a small slice: wipe, lock, boot, app-pinning).

### Architecture B — Headwind is the DPC, Dilarion is a managed app
- Headwind's DPC is provisioned as Device Owner; Dilarion is deployed *by*
  Headwind as a managed application.
- Dilarion calls Headwind's server API to trigger wipe/lock; it does **not**
  hold device-owner powers itself.
- Pro: Headwind gives you a full MDM console for free. Con: two agents, the
  "kill switch" is an API round-trip through Headwind, and Dilarion can't wipe
  on its own if the network is down.

> **Recommendation:** Architecture A. Dilarion becomes the DPC; Headwind (or your
> existing Pager-proper backend) is just the C2 dashboard. This matches "the app
> is the boss of the device" and avoids the dual-owner conflict entirely.

The rest of this doc assumes **Architecture A**.

---

## 3. How Device Owner is actually granted (this is the hard part)

`Device Owner` is **not** a runtime permission. It cannot be requested on first
launch of an app the user side-loaded onto a configured phone. It can only be
set on a **freshly factory-reset device**, by one of:

| Method | Use case | How |
|--------|----------|-----|
| `afw#setup` | Manual / prototype | On the reset "Add account" screen, type `afw#setup`, then install the DPC. |
| **QR code** | Field provisioning | Tap the welcome screen 6×, scan a QR that points at the DPC APK + checksum + config. |
| **NFC bump** | Bulk provisioning | NFC from a provisioning device. |
| **Zero-touch** | Fleet / OEM | Devices bought through a zero-touch reseller auto-enroll to your DPC on first boot. |
| `adb shell dpm set-device-owner` | Dev/testing only | Requires no accounts on device; not for production. |

Contrast with **Device Admin** (`BIND_DEVICE_ADMIN` + `DeviceAdminReceiver`):
- *Can* be requested at runtime with a user-consent dialog.
- Much weaker on modern Android — since Android 9 most device-admin policies
  were deprecated/removed. `wipeData()` still works, but lock-task, app control,
  and hardening do **not**.
- Use Device Admin only as a **prototype / fallback**, not the real design.

**Consequence for the roadmap:** the "install app → become owner on first login"
flow only works if the device was **provisioned to Dilarion's DPC at factory
reset**. The login step then *binds* the already-owner device to the operator's
identity — it does not grant ownership.

---

## 4. Implementation roadmap

### Phase 0 — Decide & stand up infra
- Confirm Architecture A. Choose C2: reuse the existing **Pager-proper backend**
  (already has `RemoteCommand`/`DeviceWipeCommand` + WS) rather than adding
  Headwind, unless you specifically want Headwind's console.
- If using Headwind: spin up a **private instance** on the sovereign server
  ([h-mdm.com](https://h-mdm.com/)) as dashboard-only.

### Phase 1 — Prototype with Device Admin (fast, no reset)
- Add `AdminReceiver : DeviceAdminReceiver` + `res/xml/device_admin.xml` policy.
- Request `BIND_DEVICE_ADMIN` at runtime; on grant, enable a **Test Wipe** button.
- Goal: trigger `DevicePolicyManager.wipeData(...)` from a remote command and see
  the device wipe. Validates the command path end-to-end.
- Limitation: no lock-task/hardening here — that needs Device Owner (Phase 2).

### Phase 2 — Device Owner provisioning (the real path)
- Package Dilarion as a DPC: implement provisioning callbacks
  (`ACTION_GET_PROVISIONING_MODE`, `ACTION_ADMIN_POLICY_COMPLIANCE`).
- Build a **QR provisioning payload** (DPC package, download URL, SHA-256 checksum,
  Wi-Fi + server config extras).
- Provision a test device: factory reset → QR scan → Dilarion installs as Device
  Owner → app auto-configures server binding in the background.
- Now `DevicePolicyManager` calls run with full owner authority.

### Phase 3 — Operational workflow (the "Kill Switch")
- **Trigger:** server detects a breach condition (geofence violation, dead-man's
  switch, manual command) → pushes command over the existing WS/command channel.
- **Extraction (optional, policy-gated):** background routine encrypts and uploads
  designated logs/media to the sovereign server *before* wipe. Gate this behind an
  explicit server flag and audit-log every run.
- **Sanitization — two levels:**
  - **App wipe:** clear the local SQLCipher DB + keychain (fast, reversible enroll).
  - **Full wipe:** `DevicePolicyManager.wipeData(WIPE_EXTERNAL_STORAGE or WIPE_RESET_PROTECTION_DATA)`
    → factory reset (Device Owner only for reset-protection wipe).

---

## 5. Reference code structure (Architecture A)

```
app/src/main/kotlin/com/dilarion/app/
├── admin/
│   ├── DilarionDeviceAdminReceiver.kt   # DeviceAdminReceiver / DPC receiver
│   ├── DevicePolicyController.kt        # wraps DevicePolicyManager: wipe, lock, policy
│   └── ProvisioningActivity.kt          # Device Owner provisioning callbacks (Phase 2)
├── monitoring/
│   └── MonitoringForegroundService.kt   # (existing) routes remote commands → controller
└── ...
res/xml/device_admin.xml                 # admin policy declaration
```

**Manifest additions (sketch):**
```xml
<receiver
    android:name=".admin.DilarionDeviceAdminReceiver"
    android:permission="android.permission.BIND_DEVICE_ADMIN"
    android:exported="true">
    <meta-data
        android:name="android.app.device_admin"
        android:resource="@xml/device_admin" />
    <intent-filter>
        <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
        <!-- Phase 2 provisioning -->
        <action android:name="android.app.action.PROFILE_PROVISIONING_COMPLETE" />
    </intent-filter>
</receiver>
```

**Wipe call (DevicePolicyController):**
```kotlin
fun fullWipe(context: Context, wipeReason: String) {
    val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    val flags = DevicePolicyManager.WIPE_EXTERNAL_STORAGE or
                DevicePolicyManager.WIPE_RESET_PROTECTION_DATA   // reset-protection needs Device Owner
    dpm.wipeData(flags, wipeReason)   // wipeReason surfaced to user post-reset (API 28+)
}

fun appOnlyWipe() {
    // clear SQLCipher DB + secure storage; keep device usable
}
```

The remote-command handler already lives in `MonitoringForegroundService` — route
a `wipe_app` / `wipe_full` command type to `DevicePolicyController` and audit it.

---

## 6. Developer toolkit

- **Android Enterprise / DPC** — [developer.android.com/work](https://developer.android.com/work/dpc/build-dpc) for building a Device Policy Controller.
- **Android Management API** — [Google's managed EMM API](https://developers.google.com/android/management); an alternative to running your own DPC/Headwind if you want Google-hosted policy.
- **Headwind MDM (open source)** — [h-mdm.com](https://h-mdm.com/); use as dashboard/C2 only under Architecture A.
- **SQLCipher** — encrypted local DB for mission data at rest (L1). Key derived from master token / Keystore.
- **Retrofit / OkHttp** — already in use for E2EE API + command channel.

---

## 7. Legal & compliance (do not skip)

An EMM agent with remote wipe and data extraction is lawful **only** with the
right footing. Bake these in from day one:

- **Ownership:** devices are organization-owned and provisioned before issue.
- **Lawful basis & authority:** documented authorization to manage and to wipe/
  extract; for government/defense use, the governing directive.
- **Disclosure:** the operator is told the device is managed (Android enforces the
  managed-device notice; do not attempt to suppress it).
- **Audit:** every wipe, extraction, and policy change is logged server-side with
  actor, reason, timestamp — you already have `CommandAuditLog` in the backend;
  extend it to device-policy actions.
- **Data handling:** extracted logs/media are sensitive; encrypt in transit and at
  rest, define retention, restrict access.
- **Distribution reality:** a public Play Store listing will almost certainly be
  rejected for these capabilities. Distribute via **managed Google Play (private
  app)**, **enterprise/zero-touch**, or sideload to provisioned devices — not the
  consumer store. (iOS equivalent: this is Android-only; iOS uses Apple's MDM
  protocol + supervised devices, a separate track.)

---

## 8. Open questions before Phase 2

1. **C2 choice:** reuse Pager-proper backend, or stand up Headwind for the console?
2. **Provisioning channel:** QR (field) vs zero-touch (fleet procurement)?
3. **Extraction policy:** what exactly gets uploaded on breach, and what is the
   retention/authority for it?
4. **Wipe granularity:** is app-wipe the default and full-wipe the escalation, or
   full-wipe always on breach?
5. **iOS:** is an equivalent managed track needed, or is Eagle One Android-only?
