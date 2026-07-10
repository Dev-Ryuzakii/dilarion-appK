package com.dilarion.app.security

import android.util.Base64
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.crypto.spec.OAEPParameterSpec
import java.security.spec.MGF1ParameterSpec
import javax.crypto.spec.PSource
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CryptoManager @Inject constructor() {

    companion object {
        private const val RSA_ALGO = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
        private const val AES_ALGO = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val KEY_BITS = 2048
    }

    // ─── RSA Key Generation ────────────────────────────────────────────────────

    fun generateKeyPair(): Pair<String, String> {
        val kpg = KeyPairGenerator.getInstance("RSA")
        kpg.initialize(KEY_BITS)
        val kp = kpg.generateKeyPair()
        val pubB64  = Base64.encodeToString(kp.public.encoded, Base64.NO_WRAP)
        val privB64 = Base64.encodeToString(kp.private.encoded, Base64.NO_WRAP)
        return Pair(pubB64, privB64)
    }

    // ─── Encrypt message with recipient public key (AES-GCM + RSA wrap) ───────

    fun encryptMessage(plaintext: String, recipientPublicKeyB64: String): Triple<String, String, String> {
        val aesKey = generateAesKey()
        val iv = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val ciphertext = aesEncrypt(plaintext.toByteArray(), aesKey, iv)
        val encryptedKey = rsaEncryptKey(aesKey.encoded, decodePublicKey(recipientPublicKeyB64))
        return Triple(
            Base64.encodeToString(ciphertext, Base64.NO_WRAP),
            Base64.encodeToString(encryptedKey, Base64.NO_WRAP),
            Base64.encodeToString(iv, Base64.NO_WRAP),
        )
    }

    fun encryptGroupMessage(plaintext: String, memberPublicKeys: Map<String, String>): Triple<String, Map<String, String>, String> {
        val aesKey = generateAesKey()
        val iv = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val ciphertext = aesEncrypt(plaintext.toByteArray(), aesKey, iv)
        
        val encryptedKeysMap = mutableMapOf<String, String>()
        for ((username, pubKeyB64) in memberPublicKeys) {
            if (pubKeyB64.isNotBlank()) {
                val pubKey = decodePublicKey(pubKeyB64)
                val encKey = rsaEncryptKey(aesKey.encoded, pubKey)
                encryptedKeysMap[username] = Base64.encodeToString(encKey, Base64.NO_WRAP)
            }
        }
        
        return Triple(
            Base64.encodeToString(ciphertext, Base64.NO_WRAP),
            encryptedKeysMap,
            Base64.encodeToString(iv, Base64.NO_WRAP)
        )
    }

    fun decryptMessage(ciphertextB64: String, encryptedKeyB64: String, ivB64: String, privateKeyB64: String): String {
        val aesKeyBytes = rsaDecryptKey(Base64.decode(encryptedKeyB64, Base64.NO_WRAP), decodePrivateKey(privateKeyB64))
        val aesKey = SecretKeySpec(aesKeyBytes, "AES")
        val iv = Base64.decode(ivB64, Base64.NO_WRAP)
        val plain = aesDecrypt(Base64.decode(ciphertextB64, Base64.NO_WRAP), aesKey, iv)
        return String(plain)
    }

    // ─── Internal helpers ──────────────────────────────────────────────────────

    private fun generateAesKey(): SecretKey {
        val kg = KeyGenerator.getInstance("AES")
        kg.init(256)
        return kg.generateKey()
    }

    private fun aesEncrypt(data: ByteArray, key: SecretKey, iv: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(AES_ALGO)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(data)
    }

    private fun aesDecrypt(data: ByteArray, key: SecretKey, iv: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(AES_ALGO)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(data)
    }

    private fun rsaEncryptKey(keyBytes: ByteArray, publicKey: PublicKey): ByteArray {
        val cipher = Cipher.getInstance(RSA_ALGO)
        val spec = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT)
        cipher.init(Cipher.ENCRYPT_MODE, publicKey, spec)
        return cipher.doFinal(keyBytes)
    }

    private fun rsaDecryptKey(encryptedKey: ByteArray, privateKey: PrivateKey): ByteArray {
        val cipher = Cipher.getInstance(RSA_ALGO)
        val spec = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT)
        cipher.init(Cipher.DECRYPT_MODE, privateKey, spec)
        return cipher.doFinal(encryptedKey)
    }

    fun decodePublicKey(b64: String): PublicKey {
        val bytes = Base64.decode(b64, Base64.NO_WRAP)
        return KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(bytes))
    }

    private fun decodePrivateKey(b64: String): PrivateKey {
        val bytes = Base64.decode(b64, Base64.NO_WRAP)
        return KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(bytes))
    }
}
