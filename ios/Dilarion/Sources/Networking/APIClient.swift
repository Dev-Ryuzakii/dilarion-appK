import Foundation

enum APIError: Error {
    case invalidURL
    case noData
    case decodingFailed(Error)
    case serverError(Int, String)
    case unauthorized
}

class APIClient {
    static let shared = APIClient()
    private init() {}

    static let turnHost = "turn.dilarion.eibstratoc.com"
    static let turnUser = "dilarion"
    static let turnPass = "dilarion2026"

    private let baseURL = "https://apidilarion.eibstratoc.com"
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
