// Date and time processing utilities

export class DateTimeProcessor {
    constructor() {
        this.timeMap = {
            'morning': 8,
            'afternoon': 14,
            'evening': 18,
            'night': 22
        };
    }

    processDateTime(datetimeString, dateReceived) {
        if (!datetimeString || datetimeString.trim() === '') {
            return dateReceived;
        }

        const receivedDate = new Date(dateReceived);
        if (isNaN(receivedDate.getTime())) {
            console.warn('Invalid dateReceived:', dateReceived);
            return null;
        }

        const datetimeLower = datetimeString.toLowerCase().trim();

        // Try to parse as absolute date first
        const absoluteDate = new Date(datetimeString);
        if (!isNaN(absoluteDate.getTime()) && datetimeString.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/)) {
            return absoluteDate;
        }

        // Handle relative dates
        const targetDate = new Date(receivedDate);

        // Yesterday, today, tomorrow
        if (datetimeLower === 'yesterday') {
            targetDate.setDate(targetDate.getDate() - 1);
            return targetDate;
        }
        if (datetimeLower === 'today') {
            return targetDate;
        }
        if (datetimeLower === 'tomorrow') {
            targetDate.setDate(targetDate.getDate() + 1);
            return targetDate;
        }

        // X days ago
        const daysAgoMatch = datetimeLower.match(/(\d+)\s+days?\s+ago/);
        if (daysAgoMatch) {
            const daysAgo = parseInt(daysAgoMatch[1]);
            targetDate.setDate(targetDate.getDate() - daysAgo);
            return targetDate;
        }

        // X hours ago
        const hoursAgoMatch = datetimeLower.match(/(\d+)\s+hours?\s+ago/);
        if (hoursAgoMatch) {
            const hoursAgo = parseInt(hoursAgoMatch[1]);
            targetDate.setHours(targetDate.getHours() - hoursAgo);
            return targetDate;
        }

        // X minutes ago
        const minutesAgoMatch = datetimeLower.match(/(\d+)\s+minutes?\s+ago/);
        if (minutesAgoMatch) {
            const minutesAgo = parseInt(minutesAgoMatch[1]);
            targetDate.setMinutes(targetDate.getMinutes() - minutesAgo);
            return targetDate;
        }

        // This morning/afternoon/evening/night
        const thisTimeMatch = datetimeLower.match(/this\s+(morning|afternoon|evening|night)/);
        if (thisTimeMatch) {
            const timeOfDay = thisTimeMatch[1];
            targetDate.setHours(this.timeMap[timeOfDay], 0, 0, 0);
            return targetDate;
        }

        // Last night/evening/morning
        const lastTimeMatch = datetimeLower.match(/last\s+(night|evening|morning)/);
        if (lastTimeMatch) {
            const timeOfDay = lastTimeMatch[1];
            targetDate.setDate(targetDate.getDate() - 1);
            const hour = timeOfDay === 'morning' ? 8 : (timeOfDay === 'evening' ? 18 : 22);
            targetDate.setHours(hour, 0, 0, 0);
            return targetDate;
        }

        // Earlier today, later today
        if (datetimeLower === 'earlier today') {
            targetDate.setHours(targetDate.getHours() - 2);
            return targetDate;
        }
        if (datetimeLower === 'later today') {
            targetDate.setHours(targetDate.getHours() + 2);
            return targetDate;
        }

        // This week, last week
        if (datetimeLower === 'this week') {
            const dayOfWeek = targetDate.getDay();
            const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            targetDate.setDate(targetDate.getDate() - daysFromMonday);
            return targetDate;
        }
        if (datetimeLower === 'last week') {
            const dayOfWeek = targetDate.getDay();
            const daysFromLastMonday = dayOfWeek === 0 ? 13 : dayOfWeek + 6;
            targetDate.setDate(targetDate.getDate() - daysFromLastMonday);
            return targetDate;
        }

        // Day of week + time of day (e.g., "Tuesday night", "Wednesday evening")
        const dayTimeMatch = datetimeLower.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(morning|afternoon|evening|night)/);
        if (dayTimeMatch) {
            const dayName = dayTimeMatch[1];
            const timeOfDay = dayTimeMatch[2];
            
            const dayIndex = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dayName);
            const currentDay = targetDate.getDay();
            
            // Find the most recent occurrence of this day
            let dayDifference = currentDay - dayIndex;
            if (dayDifference <= 0) {
                dayDifference += 7; // Go to previous week
            }
            
            targetDate.setDate(targetDate.getDate() - dayDifference);
            targetDate.setHours(this.timeMap[timeOfDay], 0, 0, 0);
            
            return targetDate;
        }

        // If we can't parse it, try one more time as a regular date
        const fallbackDate = new Date(datetimeString);
        if (!isNaN(fallbackDate.getTime())) {
            return fallbackDate;
        }

        console.warn('Could not parse datetime string:', datetimeString);
        return null;
    }

    formatDate(date) {
        if (!date || isNaN(date.getTime())) return 'Invalid Date';
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    isSameDay(date1, date2) {
        if (!date1 || !date2) return false;
        
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth() === d2.getMonth() &&
               d1.getDate() === d2.getDate();
    }
}
