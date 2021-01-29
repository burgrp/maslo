const deepEqual = require("fast-deep-equal");

module.exports = async ({
    drivers,
    driver,
    motors: motorConfigs,
    relays,
    rapidMoveSpeedMmpmin,
    cuttingMoveSpeedMmpmin,
    motorsShaftDistanceMm,
    workspaceWidthMm,
    workspaceHeightMm,
    motorsToWorkspaceVerticalMm
}) => {

    let state = {
        motorPulses: {
        },
        userOrigin: {
            xmm: 0,
            ymm: motorsToWorkspaceVerticalMm + workspaceHeightMm
        },
        positionReference: {
            xmm: -1000,
            ymm: 700,
            ap: 0,
            bp: 0
        },
        spindle: {},
        motorsShaftDistanceMm,
        workspaceWidthMm,
        workspaceHeightMm,
        motorsToWorkspaceVerticalMm
    };

    let stateChangedListeners = [];
    let oldStateJson;

    let p2 = a => a * a;
    let sqrt = Math.sqrt;
    let pulses2mm = pulses => pulses / 100;
    let mm2pulse = mm => mm * 100;

    let calcC = (a, b, base) => (p2(a) - p2(b) + p2(base)) / (2 * base);

    function checkState() {

        if (state.positionReference) {

            // calculate pulse counter as sled would be at motor A
            let originAp = mm2pulse(sqrt(p2(state.motorsShaftDistanceMm / 2 + state.positionReference.xmm) + p2(state.positionReference.ymm))) - state.positionReference.ap;
            let originBp = mm2pulse(sqrt(p2(state.motorsShaftDistanceMm / 2 - state.positionReference.xmm) + p2(state.positionReference.ymm))) - state.positionReference.bp;

            // chain lengths
            let a = pulses2mm(state.motorPulses.a + originAp);
            let b = pulses2mm(state.motorPulses.b + originBp);

            // let's have triangle MotorA-MotorB-Sled, then:
            // a is MotorA-Sled, i.e. chain length a
            // b is MotorA-Sled, i.e. chain length b
            // aa is identical to MotorA-MotorB, going from MotorA to intersection with vertical from Sled
            let aa = calcC(
                a,
                b,
                state.motorsShaftDistanceMm
            );

            state.sledPosition = {
                xmm: aa - state.motorsShaftDistanceMm / 2,
                ymm: sqrt(p2(a) - p2(aa))
            };

        } else {
            delete state.sledPosition;
        }

        let stateJson = JSON.stringify(state);
        if (stateJson !== oldStateJson) {
            oldStateJson = stateJson;
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


    motorDrivers = {};
    for (let name in motorConfigs) {
        function update() {
            state.motorPulses[name] = motorDrivers[name].getPulses();
            checkState();
        }
        motorDrivers[name] = await driver.createMotor(name, update);
        update();
    }

    for (let name in relays) {
        function update() {
            state[name].on = relays[name].isOn();
            checkState();
        }
        relays[name] = await driver.createRelay(name, relays[name], update);
        update();
    }


    function calcMoveParams(motorConfig, mm) {
        let speedMmpmin = rapidMoveSpeedMmpmin; // or cuttingMoveSpeedMmpmin if z not at home
        let pulses = mm * motorConfig.encoderPpr * motorConfig.gearRatio / (motorConfig.pitchMm * motorConfig.teethCount);
        let timeMs = 60000 * mm / speedMmpmin;
        return {pulses, timeMs}
    }

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return state;
        },

        async manualMoveStart(kind, direction) {
            if (motorDrivers[kind]) {
                let moveParams = calcMoveParams(motorConfigs[kind], 100);
                await motorDrivers[kind].move(moveParams.pulses, moveParams.timeMs);
            }
        },

        async manualMoveStop(kind) {
            if (motorDrivers[kind]) {
                await motorDrivers[kind].stop();
            }
        },

        async manualSwitch(relay, state) {
            await relays[relay].switch(state);
        },

        async setUserOrigin(xmm, ymm) {
            state.userOrigin = { xmm, ymm };
            checkState();
        }
    }
}