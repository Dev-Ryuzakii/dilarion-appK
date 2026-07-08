import Foundation

// MARK: - Auth
struct LoginRequest: Codable {
    let username: String
    let password: String
}

struct LoginResponse: Codable {
    let token: String
    let userId: Int
    let username: String

    enum CodingKeys: String, CodingKey {
        case token = "session_token"
        case userId = "user_id"
        case username
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
    let contentType: String?
    let mediaType: String?
    let timestamp: String?
    var read: Bool
    let isPrivateTagged: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case sender = "sender_username"
        case recipient = "recipient_username"
        case groupId = "group_id"
        case content
        case encryptedContent = "encrypted_content"
        case decoyContent = "decoy_content"
        case contentType = "content_type"
        case mediaType = "media_type"
        case timestamp = "created_at"
        case read = "is_read"
        case isPrivateTagged = "is_private_tagged"
    }
}

// MARK: - Send
struct SendMessageRequest: Codable {
    let recipientUsername: String?
    let groupId: Int?
    let encryptedContent: String
    let decoyContent: String?
    let isPrivateTagged: Bool?
    let replyToId: Int?
    let taggedUsername: String?

    enum CodingKeys: String, CodingKey {
        case recipientUsername = "recipient_username"
        case groupId = "group_id"
        case encryptedContent = "encrypted_content"
        case decoyContent = "decoy_content"
        case isPrivateTagged = "is_private_tagged"
        case replyToId = "reply_to_id"
        case taggedUsername = "tagged_username"
    }
}

// MARK: - Groups
struct Group: Codable, Identifiable {
    let id: Int
    let name: String
    let description: String?
    let createdAt: String?
    let createdBy: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case description
        case createdAt = "created_at"
        case createdBy = "created_by"
    }
}

struct GroupMember: Codable, Identifiable {
    let id: Int
    let username: String
    let role: String
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
    let callType: String
    let isCaller: Bool
    let status: String
    let startedAt: String?
    let duration: Int

    enum CodingKeys: String, CodingKey {
        case id
        case otherPartyUsername = "other_party_username"
        case callType = "call_type"
        case isCaller = "is_caller"
        case status
        case startedAt = "started_at"
        case duration
    }
}

// MARK: - User
struct UserProfile: Codable, Identifiable {
    let id: Int
    let username: String
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case avatarUrl = "avatar_url"
    }
}

// MARK: - Media
struct MediaItem: Codable, Identifiable {
    let mediaId: String
    let filename: String
    let mediaType: String
    let contentType: String?
    let sender: String?
    let timestamp: String?

    var id: String { mediaId }

    enum CodingKeys: String, CodingKey {
        case mediaId = "media_id"
        case filename
        case mediaType = "media_type"
        case contentType = "content_type"
        case sender
        case timestamp
    }
}
