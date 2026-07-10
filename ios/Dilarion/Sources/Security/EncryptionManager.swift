import Foundation
import CryptoKit
import Security

class EncryptionManager {
    static let shared = EncryptionManager()
    private init() {}

    // MARK: - E2EE (RSA-2048 + AES-GCM)
    
    func generateKeyPair() -> (publicKeyBase64: String, privateKeyBase64: String)? {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 2048
        ]
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error),
              let publicKey = SecKeyCopyPublicKey(privateKey) else { return nil }
        
        guard let pubData = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?,
              let privData = SecKeyCopyExternalRepresentation(privateKey, &error) as Data? else { return nil }
        
        // Prepend ASN.1 header to PKCS#1 public key to create X.509 format (for Java/Android)
        let header: [UInt8] = [
            0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 
            0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00
        ]
        var x509PubData = Data(header)
        x509PubData.append(pubData)
        return (x509PubData.base64EncodedString(), privData.base64EncodedString())
    }

    // X.509 SubjectPublicKeyInfo header for a 2048-bit RSA key. Android (and our
    // own generateKeyPair) upload keys in this SPKI form, but SecKeyCreateWithData
    // requires bare PKCS#1, so strip the header before importing.
    private static let rsa2048SPKIHeader: [UInt8] = [
        0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
        0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00
    ]

    func decodePublicKey(_ b64: String) -> SecKey? {
        guard var data = Data(base64Encoded: b64) else { return nil }
        let header = Self.rsa2048SPKIHeader
        if data.count > header.count && Array(data.prefix(header.count)) == header {
            data = data.subdata(in: header.count..<data.count)
        }
        let attrs: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecAttrKeyClass as String: kSecAttrKeyClassPublic]
        var error: Unmanaged<CFError>?
        return SecKeyCreateWithData(data as CFData, attrs as CFDictionary, &error)
    }

    func decodePrivateKey(_ b64: String) -> SecKey? {
        guard let data = Data(base64Encoded: b64) else { return nil }
        let attrs: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecAttrKeyClass as String: kSecAttrKeyClassPrivate]
        var error: Unmanaged<CFError>?
        return SecKeyCreateWithData(data as CFData, attrs as CFDictionary, &error)
    }

    func rsaEncryptKey(_ keyData: Data, publicKey: SecKey) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let ciphertext = SecKeyCreateEncryptedData(publicKey, .rsaEncryptionOAEPSHA256, keyData as CFData, &error) else { throw error!.takeRetainedValue() as Error }
        return ciphertext as Data
    }

    func rsaDecryptKey(_ encryptedKey: Data, privateKey: SecKey) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let plaintext = SecKeyCreateDecryptedData(privateKey, .rsaEncryptionOAEPSHA256, encryptedKey as CFData, &error) else { throw error!.takeRetainedValue() as Error }
        return plaintext as Data
    }

    func encryptMessage(_ plaintext: String, recipientPublicKeyB64: String) throws -> (ciphertextB64: String, encryptedKeyB64: String, ivB64: String) {
        guard let data = plaintext.data(using: .utf8), let publicKey = decodePublicKey(recipientPublicKeyB64) else { throw EncryptionError.invalidInput }
        let aesKey = SymmetricKey(size: .bits256)
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(data, using: aesKey, nonce: nonce)
        let encryptedKeyData = try rsaEncryptKey(aesKey.withUnsafeBytes { Data($0) }, publicKey: publicKey)
        // Wire format matches Android: ciphertext = ct‖tag, iv sent separately (no nonce prefix)
        return ((sealed.ciphertext + sealed.tag).base64EncodedString(), encryptedKeyData.base64EncodedString(), Data(nonce).base64EncodedString())
    }

    func encryptGroupMessage(_ plaintext: String, memberPublicKeys: [String: String]) throws -> (ciphertextB64: String, encryptedKeysMap: [String: String], ivB64: String) {
        guard let data = plaintext.data(using: .utf8) else { throw EncryptionError.invalidInput }
        let aesKey = SymmetricKey(size: .bits256)
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(data, using: aesKey, nonce: nonce)
        var encryptedKeysMap = [String: String]()
        for (username, pubKeyB64) in memberPublicKeys {
            if let pubKey = decodePublicKey(pubKeyB64) {
                let encKeyData = try rsaEncryptKey(aesKey.withUnsafeBytes { Data($0) }, publicKey: pubKey)
                encryptedKeysMap[username] = encKeyData.base64EncodedString()
            }
        }
        // Wire format matches Android: ciphertext = ct‖tag, iv sent separately
        return ((sealed.ciphertext + sealed.tag).base64EncodedString(), encryptedKeysMap, Data(nonce).base64EncodedString())
    }

    func decryptMessage(ciphertextB64: String, encryptedKeyB64: String, ivB64: String, privateKeyB64: String) throws -> String {
        // ciphertext = ct‖tag (last 16 bytes), nonce comes from the separate iv field (Android-compatible)
        guard let ctAndTag = Data(base64Encoded: ciphertextB64),
              let encKeyData = Data(base64Encoded: encryptedKeyB64),
              let ivData = Data(base64Encoded: ivB64),
              let privateKey = decodePrivateKey(privateKeyB64),
              ctAndTag.count > 16 else { throw EncryptionError.invalidInput }
        let aesKeyData = try rsaDecryptKey(encKeyData, privateKey: privateKey)
        let tag = ctAndTag.suffix(16)
        let ct = ctAndTag.prefix(ctAndTag.count - 16)
        let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: ivData), ciphertext: ct, tag: tag)
        let decrypted = try AES.GCM.open(box, using: SymmetricKey(data: aesKeyData))
        guard let result = String(data: decrypted, encoding: .utf8) else { throw EncryptionError.decryptionFailed }
        return result
    }

    // MARK: - Legacy / Server sync methods

    func encrypt(_ plaintext: String, masterToken: String) throws -> String {
        guard let data = plaintext.data(using: .utf8) else { throw EncryptionError.invalidInput }
        let sealed = try AES.GCM.seal(data, using: SymmetricKey(data: deriveKey(from: masterToken)), nonce: AES.GCM.Nonce())
        return sealed.combined!.base64EncodedString()
    }

    func decrypt(_ ciphertext: String, masterToken: String) throws -> String {
        guard let combined = Data(base64Encoded: ciphertext) else { throw EncryptionError.invalidInput }
        let decrypted = try AES.GCM.open(try AES.GCM.SealedBox(combined: combined), using: SymmetricKey(data: deriveKey(from: masterToken)))
        guard let result = String(data: decrypted, encoding: .utf8) else { throw EncryptionError.decryptionFailed }
        return result
    }

    private func deriveKey(from token: String) -> Data {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: Data(token.utf8)), salt: Data("dilarion_salt_v1".utf8), outputByteCount: 32).withUnsafeBytes { Data($0) }
    }

    enum EncryptionError: Error {
        case invalidInput
        case decryptionFailed
    }
}
