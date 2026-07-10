import Foundation
import Security

let attributes: [String: Any] = [
    kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
    kSecAttrKeySizeInBits as String: 2048
]

var error: Unmanaged<CFError>?
guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error),
      let publicKey = SecKeyCopyPublicKey(privateKey) else {
    fatalError("Failed to generate key")
}

guard let pubData = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
    fatalError("Failed to extract data")
}

let header: [UInt8] = [
    0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00
]
var x509PubData = Data(header)
x509PubData.append(pubData)

let importAttributes: [String: Any] = [
    kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
    kSecAttrKeyClass as String: kSecAttrKeyClassPublic
]
var importError: Unmanaged<CFError>?
let importedKey = SecKeyCreateWithData(x509PubData as CFData, importAttributes as CFDictionary, &importError)

if importedKey != nil {
    print("iOS can import X.509!")
} else {
    print("iOS CANNOT import X.509: \(importError!.takeRetainedValue())")
}
