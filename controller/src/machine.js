const deepEqual = require("fast-deep-equal");

module.exports = async ({
    drivers,
    driver,
    motors,
    relays,
    rapidMoveSpeedMmpmin,
    cuttingMoveSpeedMmpmin
}) => {

    let state = {
        xPosMm: 1500,
        yPosMm: 1000,
        zPosMm: 0
    };

    let stateChangedListeners = [];
    let oldState = {};

    function checkState() {
        if (!deepEqual(state, oldState)) {
            oldState = { ...state };
            for (let listener of stateChangedListeners) {
                try {
                    listener(state);
                } catch (error) {
                    console.error("Error in machine state change listener:", error);
                }
            }
        }
    }

    driver = drivers[driver];

    for (let name in motors) {
        function update() {
            state[`${name}Pulses`] = motors[name].getPulses();
            checkState();
        }
        motors[name] = await driver.createMotor(name, motors[name], update);
        update();
    }

    for (let name in relays) {
        function update() {
            state[`${name}On`] = relays[name].isOn();
            checkState();
        }
        relays[name] = await driver.createRelay(name, relays[name], update);
        update();
    }


    function calcMotorSpeed(motor) {
        return rapidMoveSpeedMmpmin * motor.encoderPpr * motor.gearRatio / 60;
    }

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return state;
        },

        async moveStart(kind, direction, pulses = Infinity) {
            if (motors[kind]) {
                let speedPps = calcMotorSpeed(motors[kind]);
                await motors[kind].move(direction, speedPps, pulses);
            }
        },

        async moveStop(kind) {
            if (motors[kind]) {
                await motors[kind].stop();
            }
        },

        async switch(relay, state) {
            await relays[relay].switch(state);
        },

        async resetOrigin() {
            state.xPosMm = 0;
            state.yPosMm = 0;
            checkState();
        }
    }
}