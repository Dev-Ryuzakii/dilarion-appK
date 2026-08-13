import Foundation

// Shared decrypt path for slim, non-Message-shaped projections (pinned/starred
// message lists) that carry the same ciphertext/encrypted_key/iv triple as a
// full Message but aren't decoded into one. Mirrors the inline decrypt loop
// in ChatViewModel.loadMessages.
enum MessageDecryption {
    static func decrypt(content: String?, encryptedKey: String?, iv: String?) -> String? {
        guard let content, let encKey = encryptedKey, let iv,
              let pk = KeychainHelper.shared.read(key: "private_key"), !pk.isEmpty else { return nil }
        let myDeviceUuid = KeychainHelper.shared.read(key: "device_uuid")
        let me = KeychainHelper.shared.read(key: "username") ?? ""
        var actualEncKey = encKey
        if encKey.hasPrefix("{"), let data = encKey.data(using: .utf8),
           let map = try? JSONDecoder().decode([String: String].self, from: data) {
            actualEncKey = (myDeviceUuid.flatMap { map[$0] }) ?? map[me] ?? encKey
        }
        return try? EncryptionManager.shared.decryptMessage(
            ciphertextB64: content, encryptedKeyB64: actualEncKey, ivB64: iv, privateKeyB64: pk
        )
    }
}
