import SwiftUI

// Month grid calendar for scheduled meetings — mirrors desktop's reference
// UX (month grid, click a day for its meetings, click a meeting to join).
// Recurrence is expanded server-side into virtual occurrences for whatever
// range we ask for, so this always re-fetches on month change rather than
// caching/merging locally.
struct MeetingCalendarView: View {
    let onJoin: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var monthAnchor: Date = Date()
    @State private var occurrences: [MeetingOccurrence] = []
    @State private var isLoading = true
    @State private var errorText: String? = nil
    @State private var selectedDay: Date? = nil

    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.firstWeekday = 1 // Sunday-start, matches the backend's week padding
        return cal
    }

    // Full weeks covering the visible month — partial recurring instances at
    // month edges still show, matching the backend's own padding.
    private var gridDays: [Date] {
        guard let monthInterval = calendar.dateInterval(of: .month, for: monthAnchor),
              let firstWeek = calendar.dateInterval(of: .weekOfMonth, for: monthInterval.start),
              let lastWeek = calendar.dateInterval(of: .weekOfMonth, for: calendar.date(byAdding: .day, value: -1, to: monthInterval.end) ?? monthInterval.end)
        else { return [] }

        var days: [Date] = []
        var cursor = firstWeek.start
        while cursor < lastWeek.end {
            days.append(cursor)
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return days
    }

    private var rangeStart: Date { gridDays.first ?? monthAnchor }
    private var rangeEnd: Date { calendar.date(byAdding: .day, value: 1, to: gridDays.last ?? monthAnchor) ?? monthAnchor }

    private func occurrences(on day: Date) -> [MeetingOccurrence] {
        occurrences.filter {
            guard let d = $0.startDate else { return false }
            return calendar.isDate(d, inSameDayAs: day)
        }
        .sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                monthHeader

                weekdayHeader

                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7), spacing: 6) {
                    ForEach(gridDays, id: \.self) { day in
                        dayCell(day)
                            .onTapGesture {
                                if !occurrences(on: day).isEmpty { selectedDay = day }
                            }
                    }
                }
                .padding(.horizontal, 12)

                if isLoading {
                    ProgressView().padding(.top, 24)
                }
                if let errorText {
                    Text(errorText).foregroundColor(.red).font(.caption).padding(.top, 12)
                }

                Spacer()
            }
            .background(Color.backgroundGrey)
            .navigationTitle("Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }.foregroundColor(.dilarionRed)
                }
            }
            .sheet(item: $selectedDay.map { IdentifiableDate(date: $0) }) { wrapped in
                DayOccurrencesSheet(day: wrapped.date, occurrences: occurrences(on: wrapped.date)) { code in
                    selectedDay = nil
                    dismiss()
                    onJoin(code)
                }
            }
        }
        .task { await load() }
        .onChange(of: monthAnchor) { _ in Task { await load() } }
    }

    private var monthHeader: some View {
        HStack {
            Button { shiftMonth(-1) } label: { Image(systemName: "chevron.left") }
            Spacer()
            Text(monthTitle)
                .font(.system(size: 17, weight: .semibold))
            Spacer()
            Button { shiftMonth(1) } label: { Image(systemName: "chevron.right") }
        }
        .foregroundColor(.textPrimary)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private var weekdayHeader: some View {
        HStack {
            ForEach(calendar.veryShortWeekdaySymbols, id: \.self) { symbol in
                Text(symbol.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.textSecondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 12)
    }

    @ViewBuilder
    private func dayCell(_ day: Date) -> some View {
        let inMonth = calendar.isDate(day, equalTo: monthAnchor, toGranularity: .month)
        let isToday = calendar.isDateInToday(day)
        let dayOccurrences = occurrences(on: day)

        VStack(spacing: 4) {
            Text("\(calendar.component(.day, from: day))")
                .font(.system(size: 13, weight: isToday ? .bold : .regular))
                .frame(width: 28, height: 28)
                .background(isToday ? Color.dilarionRed : Color.clear)
                .clipShape(Circle())
                .foregroundColor(isToday ? .white : (inMonth ? .textPrimary : .textSecondary.opacity(0.4)))

            if !dayOccurrences.isEmpty {
                Circle().fill(Color.dilarionRed).frame(width: 5, height: 5)
            } else {
                Color.clear.frame(width: 5, height: 5)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }

    private var monthTitle: String {
        let df = DateFormatter()
        df.dateFormat = "MMMM yyyy"
        return df.string(from: monthAnchor)
    }

    private func shiftMonth(_ delta: Int) {
        monthAnchor = calendar.date(byAdding: .month, value: delta, to: monthAnchor) ?? monthAnchor
    }

    private func load() async {
        isLoading = true
        errorText = nil
        do {
            occurrences = try await APIClient.shared.getMeetingCalendar(start: rangeStart, end: rangeEnd)
        } catch {
            errorText = error.localizedDescription
        }
        isLoading = false
    }
}

private struct IdentifiableDate: Identifiable {
    let date: Date
    var id: TimeInterval { date.timeIntervalSince1970 }
}

private extension Binding where Value == Date? {
    func map(_ transform: @escaping (Date) -> IdentifiableDate) -> Binding<IdentifiableDate?> {
        Binding<IdentifiableDate?>(
            get: { wrappedValue.map(transform) },
            set: { newValue in wrappedValue = newValue?.date }
        )
    }
}

private struct DayOccurrencesSheet: View {
    let day: Date
    let occurrences: [MeetingOccurrence]
    let onJoin: (String) -> Void

    var body: some View {
        NavigationStack {
            List(occurrences) { occ in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(occ.title ?? "Untitled meeting")
                            .foregroundColor(.textPrimary)
                        Text("\(formatTime(occ.occurrence_start)) · \(occ.creator_username)")
                            .font(.caption)
                            .foregroundColor(.textSecondary)
                        if occ.recurrence != nil && occ.recurrence != "null" {
                            Text((occ.recurrence ?? "").capitalized)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.dilarionRed)
                        }
                    }
                    Spacer()
                    Button("Join") { onJoin(occ.join_code) }
                        .buttonStyle(.borderedProminent)
                        .tint(.dilarionRed)
                }
                .listRowBackground(Color.surfaceWhite)
            }
            .listStyle(.plain)
            .overlay {
                if occurrences.isEmpty {
                    Text("No meetings this day").foregroundColor(.textSecondary)
                }
            }
            .navigationTitle(dayTitle)
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private var dayTitle: String {
        let df = DateFormatter()
        df.dateFormat = "EEEE, MMM d"
        return df.string(from: day)
    }

    private func formatTime(_ iso: String) -> String {
        guard let date = MeetingOccurrence.parseISODate(iso) else { return iso }
        let out = DateFormatter()
        out.timeStyle = .short
        return out.string(from: date)
    }
}
