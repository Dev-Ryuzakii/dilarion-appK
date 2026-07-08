// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Dilarion",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "Dilarion", targets: ["Dilarion"]),
    ],
    dependencies: [
        // WebRTC for iOS
        .package(url: "https://github.com/stasel/WebRTC.git", from: "125.0.0"),
    ],
    targets: [
        .target(
            name: "Dilarion",
            dependencies: [
                .product(name: "WebRTC", package: "WebRTC"),
            ],
            path: "Dilarion/Sources"
        ),
        .testTarget(
            name: "DilarionTests",
            dependencies: ["Dilarion"],
            path: "DilarionTests"
        ),
    ]
)
