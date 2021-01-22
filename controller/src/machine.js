const deepEqual = require("fast-deep-equal");

module.exports = async({ driver }) => {

    let stateChangedListeners = [];

    let state = {
        posX: 1500,
        posY: 1000,
        ...driver.getState()
    };

    let oldState = {};

    function checkState() {
        if (!deepEqual(state, oldState)) {
            oldState = {...state };
            for (let listener of stateChangedListeners) {
                try {
                    listener(state);
                } catch (error) {
                    console.error("Error in machine state change listener:", error);
                }
            }
        }
    }

    driver.onStateChanged(driverState => {
        state = {...state, ...driverState };
        checkState();
    });

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        api: {
            getState() {
                return state;
            },

            async move(startStop, kind, ...args) {
                console.info((startStop ? "start" : "stop") + " move", kind, ...args);
                if (kind === "a" || kind === "b" || kind === "z") {
                    await driver.unlimitedMove(startStop, kind, ...args);
                } else {
                    throw new Error(`Unsupported move kind "${kind}".`);
                }
            },

            async switchSpindle(onOff) {
                console.info("switch spindle", onOff ? "on" : "off");
                await driver.switchSpindle(onOff);
            },

            async resetOrigin() {
                state.posX = 0;
                state.posY = 0;
                checkState();
            }
        }

    }
}