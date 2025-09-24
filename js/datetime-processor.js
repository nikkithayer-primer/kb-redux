// Date and time processing utilities with duration support

export class DateTimeProcessor {
    constructor() {
        this.timeMap = {
            'morning': 8,
            'afternoon': 14,
            'evening': 18,
            'night': 22
        };
        
        // Month name mappings
        this.monthMap = {
            'january': 0, 'jan': 0,
            'february': 1, 'feb': 1,
            'march': 2, 'mar': 2,
            'april': 3, 'apr': 3,
            'may': 4,
            'june': 5, 'jun': 5,
            'july': 6, 'jul': 6,
            'august': 7, 'aug': 7,
            'september': 8, 'sep': 8, 'sept': 8,
            'october': 9, 'oct': 9,
            'november': 10, 'nov': 10,
            'december': 11, 'dec': 11
        };
    }

    // New method that processes datetime with duration support
    processDateTimeWithDuration(datetimeString, dateReceived) {
        if (!datetimeString || datetimeString.trim() === '') {
            const receivedDate = new Date(dateReceived);
            return {
                startDate: receivedDate,
                endDate: receivedDate,
                duration: 'instant',
                granularity: 'instant',
                originalString: datetimeString
            };
        }

        const result = this.parseDateTimeRange(datetimeString, dateReceived);
        return result;
    }

    // Enhanced method to parse date ranges and determine duration
    parseDateTimeRange(datetimeString, dateReceived) {
        const receivedDate = new Date(dateReceived);
        const cleanString = datetimeString.toLowerCase().trim();
        
        // Check for explicit date ranges (e.g., "Jan 2024 - Mar 2024", "2023-2024")
        const rangeMatch = cleanString.match(/(.+?)\s*[-–—to]\s*(.+)/);
        if (rangeMatch) {
            const startStr = rangeMatch[1].trim();
            const endStr = rangeMatch[2].trim();
            const startResult = this.parseSingleDateTime(startStr, dateReceived);
            const endResult = this.parseSingleDateTime(endStr, dateReceived);
            
            if (startResult && endResult) {
                return {
                    startDate: startResult.date,
                    endDate: endResult.date,
                    duration: this.calculateDuration(startResult.date, endResult.date),
                    granularity: this.determineGranularity(startResult.granularity, endResult.granularity),
                    originalString: datetimeString
                };
            }
        }
        
        // Parse single datetime
        const singleResult = this.parseSingleDateTime(cleanString, dateReceived);
        if (singleResult) {
            const { date, granularity } = singleResult;
            const endDate = this.calculateEndDateFromGranularity(date, granularity);
            
            return {
                startDate: date,
                endDate: endDate,
                duration: this.calculateDuration(date, endDate),
                granularity: granularity,
                originalString: datetimeString
            };
        }
        
        // Fallback to original method
        const fallbackDate = this.processDateTime(datetimeString, dateReceived);
        return {
            startDate: fallbackDate,
            endDate: fallbackDate,
            duration: 'instant',
            granularity: 'instant',
            originalString: datetimeString
        };
    }

    // Parse a single datetime string and determine its granularity
    parseSingleDateTime(datetimeString, dateReceived) {
        const receivedDate = new Date(dateReceived);
        const cleanString = datetimeString.toLowerCase().trim();
        
        // Year only (e.g., "2023", "2024")
        const yearMatch = cleanString.match(/^(\d{4})$/);
        if (yearMatch) {
            const year = parseInt(yearMatch[1]);
            return {
                date: new Date(year, 0, 1), // January 1st
                granularity: 'year'
            };
        }
        
        // Month and year (e.g., "May 2024", "January 2023")
        const monthYearMatch = cleanString.match(/^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{4})$/);
        if (monthYearMatch) {
            const monthName = monthYearMatch[1];
            const year = parseInt(monthYearMatch[2]);
            const month = this.monthMap[monthName];
            return {
                date: new Date(year, month, 1),
                granularity: 'month'
            };
        }
        
        // Quarter (e.g., "Q1 2024", "Q3 2023")
        const quarterMatch = cleanString.match(/^q([1-4])\s+(\d{4})$/);
        if (quarterMatch) {
            const quarter = parseInt(quarterMatch[1]);
            const year = parseInt(quarterMatch[2]);
            const month = (quarter - 1) * 3; // Q1=0, Q2=3, Q3=6, Q4=9
            return {
                date: new Date(year, month, 1),
                granularity: 'quarter'
            };
        }
        
        // Specific date (e.g., "2024-05-15", "May 15, 2024")
        const specificDate = new Date(datetimeString);
        if (!isNaN(specificDate.getTime()) && datetimeString.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/)) {
            return {
                date: specificDate,
                granularity: 'day'
            };
        }
        
        // Fall back to original processing
        const originalResult = this.processDateTime(datetimeString, dateReceived);
        if (originalResult) {
            return {
                date: originalResult,
                granularity: 'day'
            };
        }
        
        return null;
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

    // Calculate end date based on granularity
    calculateEndDateFromGranularity(startDate, granularity) {
        const endDate = new Date(startDate);
        
        switch (granularity) {
            case 'year':
                endDate.setFullYear(endDate.getFullYear() + 1);
                endDate.setDate(endDate.getDate() - 1); // Last day of year
                break;
            case 'quarter':
                endDate.setMonth(endDate.getMonth() + 3);
                endDate.setDate(endDate.getDate() - 1); // Last day of quarter
                break;
            case 'month':
                endDate.setMonth(endDate.getMonth() + 1);
                endDate.setDate(endDate.getDate() - 1); // Last day of month
                break;
            case 'day':
                endDate.setHours(23, 59, 59, 999); // End of day
                break;
            default:
                return startDate; // Instant
        }
        
        return endDate;
    }

    // Calculate duration between two dates
    calculateDuration(startDate, endDate) {
        const diffMs = endDate.getTime() - startDate.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays <= 1) return 'instant';
        if (diffDays <= 7) return 'days';
        if (diffDays <= 31) return 'weeks';
        if (diffDays <= 365) return 'months';
        return 'years';
    }

    // Determine combined granularity for ranges
    determineGranularity(startGranularity, endGranularity) {
        const granularityOrder = ['instant', 'day', 'month', 'quarter', 'year'];
        const startIndex = granularityOrder.indexOf(startGranularity);
        const endIndex = granularityOrder.indexOf(endGranularity);
        
        // Return the broader granularity
        return granularityOrder[Math.max(startIndex, endIndex)];
    }

    // Format duration for display
    formatDuration(durationInfo) {
        const { startDate, endDate, duration, granularity } = durationInfo;
        
        if (duration === 'instant') {
            return this.formatDate(startDate);
        }
        
        const startFormatted = this.formatDateByGranularity(startDate, granularity);
        const endFormatted = this.formatDateByGranularity(endDate, granularity);
        
        if (startFormatted === endFormatted) {
            return startFormatted;
        }
        
        return `${startFormatted} - ${endFormatted}`;
    }

    // Format date based on granularity
    formatDateByGranularity(date, granularity) {
        if (!date || isNaN(date.getTime())) return 'Invalid Date';
        
        switch (granularity) {
            case 'year':
                return date.getFullYear().toString();
            case 'quarter':
                const quarter = Math.floor(date.getMonth() / 3) + 1;
                return `Q${quarter} ${date.getFullYear()}`;
            case 'month':
                return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            case 'day':
                return date.toLocaleDateString();
            default:
                return this.formatDate(date);
        }
    }

    // Get timeline nesting level for hierarchical display
    getTimelineLevel(granularity) {
        const levels = {
            'instant': 0,
            'day': 1,
            'month': 2,
            'quarter': 2,
            'year': 3
        };
        return levels[granularity] || 0;
    }
}
