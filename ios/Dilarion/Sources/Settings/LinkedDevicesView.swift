import SwiftUI
import AVFoundation

@MainActor
final class LinkedDevicesViewModel: ObservableObject {
    @Published var devices: [MyDevice] = []
    @Published var loading = true
    @Published var message: String?

    func load() {
        Task {
            loading = true
            do {
                let resp: MyDevicesResponse = try await APIClient.shared.get("/devices")
                devices = resp.devices
            } catch {
                message = "Could not load devices"
            }
            loading = false
        }
    }

    /// Handle a scanned QR. Expects "dilarion:link:<nonce>" (a bare nonce also works).
    func approveScanned(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let nonce = trimmed.hasPrefix("dilarion:link:")
            ? String(trimmed.dropFirst("dilarion:link:".count))
            : trimmed
        guard nonce.count >= 8 else {
            message = "That QR code is not a Dilarion link code"
            return
        }
        Task {
            do {
                try await APIClient.shared.postVoid("/devices/link/approve", body: DeviceLinkApproveRequest(nonce: nonce))
                message = "Device linked"
                load()
            } catch APIError.serverError(let code, _) {
                message = code == 410 ? "Link code expired — regenerate it on the other device"
                        : code == 404 ? "Link code not found or already used"
                        : "Could not link device (\(code))"
            } catch {
                message = "Could not link device"
            }
        }
    }

    func revoke(_ uuid: String) {
        Task {
            try? await APIClient.shared.postVoid("/devices/\(uuid)/revoke", body: EmptyBody())
            load()
        }
    }
}

struct LinkedDevicesView: View {
    @StateObject private var vm = LinkedDevicesViewModel()
    @State private var showScanner = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Scan the QR shown on your desktop or another device to link it. Each device gets its own key; you can unlink any of them here.")
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                Button {
                    showScanner = true
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "qrcode.viewfinder")
                        Text("Link a device").fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.dilarionRed)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .padding(.horizontal, 16)

                if vm.loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 24)
                } else if vm.devices.isEmpty {
                    Text("No linked devices yet")
                        .foregroundColor(.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                } else {
                    ForEach(vm.devices) { device in
                        DeviceRow(device: device) { vm.revoke(device.device_uuid) }
                            .padding(.horizontal, 16)
                    }
                }
            }
        }
        .navigationTitle("Linked devices")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showScanner) {
            QRScannerView { code in
                showScanner = false
                vm.approveScanned(code)
            }
        }
        .alert("Devices", isPresented: Binding(get: { vm.message != nil }, set: { if !$0 { vm.message = nil } })) {
            Button("OK") { vm.message = nil }
        } message: {
            Text(vm.message ?? "")
        }
        .onAppear { vm.load() }
    }
}

private struct DeviceRow: View {
    let device: MyDevice
    let onRevoke: () -> Void
    @State private var confirm = false

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: iconName)
                .font(.system(size: 18))
                .foregroundColor(.dilarionRed)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(device.device_name ?? device.platform.capitalized)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.textPrimary)
                Text(device.platform.capitalized)
                    .font(.system(size: 12))
                    .foregroundColor(.textSecondary)
            }
            Spacer()
            Button("Unlink", role: .destructive) { confirm = true }
                .font(.system(size: 14))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Color.surfaceWhite)
        .cornerRadius(12)
        .confirmationDialog("Unlink \(device.device_name ?? device.platform)?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Unlink", role: .destructive, action: onRevoke)
            Button("Cancel", role: .cancel) {}
        }
    }

    private var iconName: String {
        switch device.platform {
        case "desktop": return "laptopcomputer"
        case "ios": return "iphone"
        case "android": return "smartphone"
        default: return "desktopcomputer"
        }
    }
}

// MARK: - QR scanner (AVFoundation)

struct QRScannerView: UIViewControllerRepresentable {
    let onFound: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerController {
        let controller = ScannerController()
        controller.onFound = onFound
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerController, context: Context) {}
}

final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onFound: ((String) -> Void)?
    private let session = AVCaptureSession()
    private var didFind = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard
            let device = AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input)
        else { return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.frame = view.layer.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.session.startRunning() }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if session.isRunning { session.stopRunning() }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard
            !didFind,
            let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            let value = obj.stringValue
        else { return }
        didFind = true
        session.stopRunning()
        onFound?(value)
    }
}
