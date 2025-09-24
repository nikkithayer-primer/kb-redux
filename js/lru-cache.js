// LRU (Least Recently Used) Cache implementation for memory management

export class LRUCache {
    constructor(maxSize = 1000, maxMemoryMB = 50) {
        this.maxSize = maxSize;
        this.maxMemoryBytes = maxMemoryMB * 1024 * 1024; // Convert MB to bytes
        this.cache = new Map();
        this.accessOrder = new Map(); // Track access order for LRU
        this.memoryUsage = 0;
        this.accessCounter = 0;
    }

    set(key, value) {
        const serializedValue = JSON.stringify(value);
        const itemSize = this.calculateSize(key, serializedValue);
        
        // Remove existing entry if it exists
        if (this.cache.has(key)) {
            this.delete(key);
        }
        
        // Ensure we have space
        this.ensureCapacity(itemSize);
        
        // Add new entry
        this.cache.set(key, {
            value: value,
            size: itemSize,
            accessTime: ++this.accessCounter
        });
        
        this.accessOrder.set(key, this.accessCounter);
        this.memoryUsage += itemSize;
        
        // Final check to ensure we're within limits
        this.cleanup();
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }
        
        // Update access time for LRU tracking
        entry.accessTime = ++this.accessCounter;
        this.accessOrder.set(key, this.accessCounter);
        
        return entry.value;
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        const entry = this.cache.get(key);
        if (entry) {
            this.memoryUsage -= entry.size;
            this.cache.delete(key);
            this.accessOrder.delete(key);
            return true;
        }
        return false;
    }

    clear() {
        this.cache.clear();
        this.accessOrder.clear();
        this.memoryUsage = 0;
        this.accessCounter = 0;
    }

    size() {
        return this.cache.size;
    }

    getMemoryUsage() {
        return {
            bytes: this.memoryUsage,
            mb: (this.memoryUsage / (1024 * 1024)).toFixed(2),
            percentage: ((this.memoryUsage / this.maxMemoryBytes) * 100).toFixed(1)
        };
    }

    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            memory: this.getMemoryUsage(),
            maxMemoryMB: this.maxMemoryBytes / (1024 * 1024)
        };
    }

    // Private methods
    calculateSize(key, serializedValue) {
        // Rough estimation of memory usage in bytes
        const keySize = new Blob([key]).size;
        const valueSize = new Blob([serializedValue]).size;
        return keySize + valueSize + 100; // Add overhead for object structure
    }

    ensureCapacity(newItemSize) {
        // Check if we need to free up space
        while (
            (this.cache.size >= this.maxSize) || 
            (this.memoryUsage + newItemSize > this.maxMemoryBytes)
        ) {
            this.evictLRU();
        }
    }

    evictLRU() {
        if (this.cache.size === 0) return;
        
        // Find the least recently used item
        let oldestKey = null;
        let oldestAccessTime = Infinity;
        
        for (const [key, accessTime] of this.accessOrder) {
            if (accessTime < oldestAccessTime) {
                oldestAccessTime = accessTime;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.delete(oldestKey);
        }
    }

    cleanup() {
        // Periodic cleanup to ensure we stay within limits
        while (this.cache.size > this.maxSize || this.memoryUsage > this.maxMemoryBytes) {
            this.evictLRU();
        }
    }

    // Debug method to see current cache contents
    debug() {
        return {
            size: this.cache.size,
            memory: this.getMemoryUsage(),
            keys: Array.from(this.cache.keys()).slice(0, 10) // Show first 10 keys
        };
    }
}
