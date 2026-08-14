import SwiftUI

// First screen when tapping into Meetings — Instant vs Scheduled, matching
// desktop's Meetings tab (HomeScreen.tsx) and Android's MeetingsTab exactly.
// Rejoin is iOS-only for now: pure client-side bookkeeping (no backend
// concept of "rejoin"), just replaying the last meeting's join code/
// conference id — see MeetingViewModel.rejoin().
struct MeetingsLandingSheet: View {
    let onJoinByCode: (String) -> Void
    let onStartInstant: ([String]) -> Void

    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var meetingVM = MeetingViewModel.shared
    @State private var showNewMeeting = false
    @State private var showScheduled = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    if let rejoin = meetingVM.rejoinable {
                        Button {
                            dismiss()
                            meetingVM.rejoin()
                        } label: {
                            HStack(spacing: 14) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 10).fill(Color.green)
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                        .foregroundColor(.white)
                                }
                                .frame(width: 40, height: 40)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Rejoin: \(rejoin.title)")
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundColor(.textPrimary)
                                    Text("Meeting may still be in progress")
                                        .font(.system(size: 12))
                                        .foregroundColor(.textSecondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(.textSecondary.opacity(0.6))
                            }
                            .padding(14)
                            .background(Color.surfaceWhite)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                    }

                    landingCard(
                        icon: "video.fill",
                        title: "Start Instant Meeting",
                        subtitle: "Group video — invite anyone, add more later"
                    ) {
                        showNewMeeting = true
                    }

                    landingCard(
                        icon: "calendar",
                        title: "Scheduled Meetings",
                        subtitle: "Upcoming, join by code, or schedule a new one"
                    ) {
                        showScheduled = true
                    }
                }
                .padding(16)
            }
            .background(Color.backgroundGrey)
            .navigationTitle("Meetings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }.foregroundColor(.dilarionRed)
                }
            }
        }
        .sheet(isPresented: $showNewMeeting) {
            NewMeetingSheet(onStart: { invitees in
                showNewMeeting = false
                dismiss()
                onStartInstant(invitees)
            })
        }
        .sheet(isPresented: $showScheduled) {
            MeetingsSheet(onJoin: { joinCode in
                showScheduled = false
                dismiss()
                onJoinByCode(joinCode)
            })
        }
    }

    private func landingCard(icon: String, title: String, subtitle: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10).fill(Color.dilarionRed)
                    Image(systemName: icon).foregroundColor(.white)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.textPrimary)
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundColor(.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.textSecondary.opacity(0.6))
            }
            .padding(14)
            .background(Color.surfaceWhite)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}
