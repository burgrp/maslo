const deepEqual = require("fast-deep-equal");

module.exports = async({}) => {

    let stateChangedListeners = [];

    let state = {
        chainA: 1500,
        chainB: 1600,
        spindleOn: false
    };

    let oldState = {};

    function checkState() {
        if (!deepEqual(state, oldState)) {
            oldState = {...state };
            for (let listener of stateChangedListeners) {
                try {
                    listener(state);
                } catch (error) {
                    console.error("Error in virtual driver state change listener:", error);
                }
            }
        }
    }

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return state;
        },

        async unlimitedMove(startStop, chain, direction) {
            console.info(arguments);
        },

        async switchSpindle(onOff) {
            state.spindleOn = onOff;
            checkState();
        }
    }
}