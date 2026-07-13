import Foundation

// MARK: - Auth
struct LoginRequest: Codable {
    let username: String
    let token: String
}

struct LoginResponse: Codable {
    let token: String
    let username: String
    let isAdmin: Bool

    enum CodingKeys: String, CodingKey {
        case token
        case username
        case isAdmin = "is_admin"
    }
}

// MARK: - Messages
struct Message: Codable, Identifiable {
    let id: Int
    let sender: String?
    let recipient: String?
    let groupId: Int?
    let content: String?
    let encryptedContent: String?
    let decoyContent: String?
    let encryptedKey: String?
    let iv: String?
    let contentType: String?
    let mediaType: String?
    let timestamp: String?
    var read: Bool
    let isPrivateTagged: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case sender
        case recipient
        case groupId = "group_id"
        case content
        case encryptedContent = "encrypted_content"
        case decoyContent = "decoy_content"
        case encryptedKey = "encrypted_key"
        case iv
        case contentType = "content_type"
        case mediaType = "media_type"
        case timestamp
        case read
        case isPrivateTagged = "is_private_tagged"
    }
}

// Wrapper — GET /messages/inbox returns { messages: [...], count: N }
struct InboxResponse: Codable {
    let messages: [Message]
    let count: Int?
}

// Wrapper — GET /messages/group/{id} returns { messages: [...], count: N }
struct GroupMessagesResponse: Codable {
    let messages: [Message]
    let count: Int?
}

// MARK: - Send DM: POST /messages/send → { username, message }
struct SendDmRequest: Codable {
    let username: String
    let message: String
    let encryptedKey: String?
    let iv: String?
    let decoyContent: String?

    enum CodingKeys: String, CodingKey {
        case username
        case message
        case encryptedKey = "encrypted_key"
        case iv
        case decoyContent = "decoy_content"
    }
}

// MARK: - Send Group: POST /messages/group/send → { group_id, message, addressed_to_username? }
struct SendGroupMessageRequest: Codable {
    let groupId: Int
    let message: String
    let addressedToUsername: String?
    let encryptedKey: String?
    let iv: String?
    let decoyContent: String?

    enum CodingKeys: String, CodingKey {
        case groupId = "group_id"
        case message
        case addressedToUsername = "addressed_to_username"
        case encryptedKey = "encrypted_key"
        case iv
        case decoyContent = "decoy_content"
    }
}

// MARK: - Groups
struct Group: Codable, Identifiable {
    let id: Int
    let name: String
    let description: String?
    let createdAt: String?
    let createdBy: Int?
    let memberCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case description
        case createdAt = "created_at"
        case createdBy = "created_by"
        case memberCount = "member_count"
    }
}

struct GroupMember: Codable, Identifiable {
    var id: Int { userId }
    let userId: Int
    let username: String
    let role: String
    let joinedAt: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case username
        case role
        case joinedAt = "joined_at"
    }
}

// MARK: - Calls
struct IncomingCallData: Codable, Identifiable {
    let id: Int
    let callerUsername: String
    let callType: String
    let offerSdp: String?

    enum CodingKeys: String, CodingKey {
        case id = "call_id"
        case callerUsername = "caller_username"
        case callType = "call_type"
        case offerSdp = "offer_sdp"
    }
}

struct CallHistoryItem: Codable, Identifiable {
    let id: Int
    let otherPartyUsername: String?
    let callType: String?
    let isCaller: Bool
    let status: String?
    let startedAt: String?
    let endedAt: String?
    let duration: Int

    enum CodingKeys: String, CodingKey {
        case id
        case otherPartyUsername = "other_party_username"
        case callType = "call_type"
        case isCaller = "is_caller"
        case status
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case duration
    }
}

// Wrapper — GET /calls/history returns { calls: [...], count: N }
struct CallHistoryResponse: Codable {
    let calls: [CallHistoryItem]
    let count: Int?
}

// MARK: - User
struct UserProfile: Codable, Identifiable {
    let apiId: Int?
    let username: String
    let registered: String?

    var id: String { username }

    enum CodingKeys: String, CodingKey {
        case apiId = "id"
        case username
        case registered
    }
}

// Conformance: use username for List identification
extension UserProfile: Hashable {
    static func == (lhs: UserProfile, rhs: UserProfile) -> Bool { lhs.username == rhs.username }
    func hash(into hasher: inout Hasher) { hasher.combine(username) }
}

// MARK: - Media
struct MediaItem: Codable, Identifiable {
    let mediaId: String
    let filename: String
    let mediaType: String
    let contentType: String?
    let fileSize: Int?
    let sender: String?
    let recipient: String?
    let timestamp: String?
    let autoDelete: Bool?
    let downloaded: Bool?

    var id: String { mediaId }

    enum CodingKeys: String, CodingKey {
        case mediaId = "media_id"
        case filename
        case mediaType = "media_type"
        case contentType = "content_type"
        case fileSize = "file_size"
        case sender
        case recipient
        case timestamp
        case autoDelete = "auto_delete"
        case downloaded
    }
}

struct MediaInboxResponse: Codable {
    let mediaFiles: [MediaItem]?
    let count: Int?

    enum CodingKeys: String, CodingKey {
        case mediaFiles = "media_files"
        case count
    }
}

struct MediaUploadResponse: Codable {
    let mediaId: String?
    let filename: String?
    let mediaType: String?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case mediaId = "media_id"
        case filename
        case mediaType = "media_type"
        case message
    }
}

// MARK: - Empty Body
struct EmptyBody: Codable {}

// MARK: - Multi-device linking
struct DeviceRegisterRequest: Codable {
    let public_key: String
    let platform: String
    let device_name: String
}

struct DeviceRegisterResponse: Codable {
    let device_uuid: String
}

struct DeviceLinkApproveRequest: Codable {
    let nonce: String
}

struct DeviceKey: Codable {
    let device_uuid: String
    let public_key: String
    let platform: String?
}

struct UserDevicesResponse: Codable {
    let devices: [DeviceKey]
}

struct MyDevice: Codable, Identifiable {
    let device_uuid: String
    let platform: String
    let device_name: String?
    let created_at: String?
    let last_seen: String?
    var id: String { device_uuid }
}

struct MyDevicesResponse: Codable {
    let devices: [MyDevice]
}

// MARK: - Call Signaling
struct CallInitiateRequest: Codable {
    let recipientUsername: String
    let callType: String
    let offerSdp: String?

    enum CodingKeys: String, CodingKey {
        case recipientUsername = "recipient_username"
        case callType = "call_type"
        case offerSdp = "offer_sdp"
    }
}

struct CallActionRequest: Codable {
    let callId: Int
    let action: String
    let answerSdp: String?
    let mastertoken: String?

    enum CodingKeys: String, CodingKey {
        case callId = "call_id"
        case action
        case answerSdp = "answer_sdp"
        case mastertoken
    }
}

struct CallResponse: Codable {
    let callId: Int?
    let status: String?
    let timestamp: String?

    enum CodingKeys: String, CodingKey {
        case callId = "call_id"
        case status
        case timestamp
    }
}

struct WebRTCIceCandidate: Codable {
    let sdpMid: String
    let sdpMLineIndex: Int
    let candidate: String
}

struct IceCandidateRequest: Codable {
    let callId: Int
    let recipientUsername: String
    let candidate: WebRTCIceCandidate

    enum CodingKeys: String, CodingKey {
        case callId = "call_id"
        case recipientUsername = "recipient_username"
        case candidate
    }
}

// MARK: - Master Token
struct MasterTokenRequest: Codable {
    let masterToken: String

    enum CodingKeys: String, CodingKey {
        case masterToken = "master_token"
    }
}
