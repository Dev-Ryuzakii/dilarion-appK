import SwiftUI

// MARK: — ViewModel (mirrors SplashViewModel.kt: 2s delay, check token)
class SplashViewModel: ObservableObject {
    enum Destination { case loading, auth, home }
    @Published var destination: Destination = .loading

    init() {
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            let token = KeychainHelper.shared.read(key: "session_token") ?? ""
            await MainActor.run {
                if token.isEmpty {
                    self.destination = .auth
                } else {
                    WebSocketManager.shared.connect(token: token)
                    self.destination = .home
                }
            }
        }
    }
}

// MARK: — SplashView (mirrors SplashScreen.kt exactly)
// Red fill, circular logo 140pt, subtitle, 3 bouncing dots
struct SplashView: View {
    @State private var scale: CGFloat = 0.85
    @State private var dotOffsets: [CGFloat] = [0, 0, 0]

    var body: some View {
        ZStack {
            Color.dilarionRed.ignoresSafeArea()

            VStack(spacing: 20) {
                // Circular logo — matches R.drawable.dilarion_logo clipped to CircleShape 140dp
                LogoImage(size: 140)
                    .scaleEffect(scale)
                    .onAppear {
                        withAnimation(.spring(response: 0.5, dampingFraction: 0.6)) {
                            scale = 1.0
                        }
                    }

                Text("Secure · Private · Encrypted")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundColor(.white.opacity(0.75))
                    .tracking(0.5)
            }

            // Bouncing dots — bottom center, mirrors bouncingDot(delay:)
            VStack {
                Spacer()
                HStack(spacing: 10) {
                    ForEach(0..<3, id: \.self) { i in
                        Circle()
                            .fill(Color.white.opacity(0.85))
                            .frame(width: 8, height: 8)
                            .offset(y: dotOffsets[i])
                    }
                }
                .padding(.bottom, 60)
            }
        }
        .onAppear { startDotAnimation() }
    }

    private func startDotAnimation() {
        let delays: [Double] = [0, 0.2, 0.4]
        for (i, delay) in delays.enumerated() {
            animateDot(index: i, delay: delay)
        }
    }

    private func animateDot(index: Int, delay: Double) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            withAnimation(
                .easeInOut(duration: 0.3)
                .repeatForever(autoreverses: false)
                .delay(delay)
            ) {
                dotOffsets[index] = -8
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                withAnimation(.easeInOut(duration: 0.3)) {
                    dotOffsets[index] = 0
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                    animateDot(index: index, delay: 0)
                }
            }
        }
    }
}

// MARK: — Reusable logo component
struct LogoImage: View {
    let size: CGFloat

    var body: some View {
        Group {
            if let uiImage = UIImage(named: "dilarion_logo") {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
            } else {
                // Fallback if asset not added yet
                ZStack {
                    Color.white
                    Text("D")
                        .font(.system(size: size * 0.45, weight: .black))
                        .foregroundColor(.dilarionRed)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}
