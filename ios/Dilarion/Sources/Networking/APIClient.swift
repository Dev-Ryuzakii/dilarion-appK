import Foundation

enum APIError: Error {
    case invalidURL
    case noData
    case decodingFailed(Error)
    case serverError(Int, String)
    case unauthorized
}

extension APIError: CustomNSError, LocalizedError {
    static var errorDomain: String { "Dilarion.APIError" }

    var errorCode: Int {
        switch self {
        case .invalidURL: return 0
        case .noData: return 1
        case .decodingFailed: return 2
        case .serverError(let code, _): return code
        case .unauthorized: return 401
        }
    }

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API Endpoint URL"
        case .noData:
            return "Empty response received from server"
        case .decodingFailed(let err):
            return "Failed to parse server response: \(err.localizedDescription)"
        case .serverError(_, let msg):
            return msg
        case .unauthorized:
            return "Session expired. Please log in again."
        }
    }
}

class APIClient {
    static let shared = APIClient()
    private init() {}

    static let turnHost = "turn.dilarion.eibstratoc.com"
    static let turnUser = "dilarion"
    static let turnPass = "dilarion2026"

    // Set via API_BASE_URL in Config-Production.xcconfig / Config-Staging.xcconfig,
    // injected into Info.plist at build time. Falls back to production so a
    // misconfigured build never silently talks to nothing.
    private let baseURL = (Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String)
        .flatMap { $0.isEmpty ? nil : $0 } ?? "https://apidilarion.eibstratoc.com"
    private var token: String? {
        KeychainHelper.shared.read(key: "session_token")
    }

    private func makeRequest(path: String, method: String = "GET", body: Data? = nil) -> URLRequest? {
        guard let url = URL(string: baseURL + path) else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = body
        return req
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        guard let req = makeRequest(path: path) else { throw APIError.invalidURL }
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data)
        return try decode(data)
    }

    func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        let bodyData = try JSONEncoder().encode(body)
        guard let req = makeRequest(path: path, method: "POST", body: bodyData) else { throw APIError.invalidURL }
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data)
        return try decode(data)
    }

    func postVoid<B: Encodable>(_ path: String, body: B) async throws {
        let bodyData = try JSONEncoder().encode(body)
        guard let req = makeRequest(path: path, method: "POST", body: bodyData) else { throw APIError.invalidURL }
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data)
    }

    func putVoid(_ path: String) async throws {
        guard let req = makeRequest(path: path, method: "PUT") else { throw APIError.invalidURL }
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data)
    }

    func postMultipart<T: Decodable>(
        _ path: String,
        parameters: [String: String],
        fileData: Data,
        fileName: String,
        fileFieldName: String = "file",
        mimeType: String
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else { throw APIError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        
        let boundary = "Boundary-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        var body = Data()
        
        // Add form fields
        for (key, value) in parameters {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: text/plain; charset=utf-8\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        
        // Add file
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fileFieldName)\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n".data(using: .utf8)!)
        
        // End boundary
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        
        req.httpBody = body
        
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data)
        return try decode(data)
    }

    func getData(_ path: String) async throws -> Data {
        guard let url = URL(string: baseURL + path) else { throw APIError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data)
        return data
    }

    private func validate(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if http.statusCode >= 400 {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["detail"] ?? "Unknown error"
            throw APIError.serverError(http.statusCode, msg)
        }
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            let decoder = JSONDecoder()
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }
}
