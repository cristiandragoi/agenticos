let latest = null;
export const diagnosticsStore = {
    setUiSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object')
            return;
        latest = snapshot;
    },
    getUiSnapshot() {
        return latest;
    },
    clear() {
        latest = null;
    },
};
