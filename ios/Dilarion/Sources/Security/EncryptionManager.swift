import Foundation
import CryptoKit

class EncryptionManager {
    static let shared = EncryptionManager()
    private init() {}

    // AES-256-GCM encrypt — matches Android/desktop implementation
    func encrypt(_ plaintext: String, masterToken: String) throws -> String {
        guard let data = plaintext.data(using: .utf8) else {
            throw EncryptionError.invalidInput
        }
        let keyData = deriveKey(from: masterToken)
        let key = SymmetricKey(data: keyData)
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(data, using: key, nonce: nonce)
        let combined = sealed.combined!
        return combined.base64EncodedString()
    }

    func decrypt(_ ciphertext: String, masterToken: String) throws -> String {
        guard let combined = Data(base64Encoded: ciphertext) else {
            throw EncryptionError.invalidInput
        }
        let keyData = deriveKey(from: masterToken)
        let key = SymmetricKey(data: keyData)
        let sealed = try AES.GCM.SealedBox(combined: combined)
        let decrypted = try AES.GCM.open(sealed, using: key)
        guard let result = String(data: decrypted, encoding: .utf8) else {
            throw EncryptionError.decryptionFailed
        }
        return result
    }

    private func deriveKey(from token: String) -> Data {
        let tokenData = Data(token.utf8)
        let salt = Data("dilarion_salt_v1".utf8)
        let hashed = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: tokenData),
            salt: salt,
            outputByteCount: 32
        )
        return hashed.withUnsafeBytes { Data($0) }
    }

    enum EncryptionError: Error {
        case invalidInput
        case decryptionFailed
    }
}
