const deepEqual = require("fast-deep-equal");

function distanceToPulses(motorConfig, distanceMm) {
    return distanceMm * motorConfig.encoderPpr * motorConfig.gearRatio / (motorConfig.pitchMm * motorConfig.teethCount));
}

function pulsesToDistance(motorConfig, pulses) {
    return pulses * motorConfig.pitchMm * motorConfig.teethCount / (motorConfig.encoderPpr * motorConfig.gearRatio);
}

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

    let calcC = (a, b, base) => (p2(a) - p2(b) + p2(base)) / (2 * base);

    function checkState() {

        if (state.positionReference) {

            // calculate pulse counter as sled would be at motor A
            let originAp = distanceToPulses(motorConfigs.a, sqrt(p2(state.motorsShaftDistanceMm / 2 + state.positionReference.xmm) + p2(state.positionReference.ymm))) - state.positionReference.ap;
            let originBp = distanceToPulses(motorConfigs.b, sqrt(p2(state.motorsShaftDistanceMm / 2 - state.positionReference.xmm) + p2(state.positionReference.ymm))) - state.positionReference.bp;

            // chain lengths
            let a = pulsesToDistance(motorConfigs.a, state.motorPulses.a + originAp);
            let b = pulsesToDistance(motorConfigs.b, state.motorPulses.b + originBp);

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

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return state;
        },

        async manualMoveStart(kind, ...direction) {

            let distanceMm = 100;
            let timeMs = 60000 * distanceMm / rapidMoveSpeedMmpmin;

            if (kind == "a" || kind == "b") {
                
                await motorDrivers[kind].move(
                    direction[0] * distanceToPulses(motorConfigs[kind], distanceMm),
                    timeMs
                );

            } else if (kind === "xy") {
                
                let base = (a, b) => Math.sqrt(a * a + b * b);
                //let arm = (c, a) => Math.sqrt(c * c - a * a);
                
                let length = pos => ({
                    a: base(motorsShaftDistanceMm / 2 + pos.x, pos.y),
                    b: base(motorsShaftDistanceMm / 2 - pos.x, pos.y)
                });
                
                let pos1 = {
                    x: state.sledPosition.xmm, 
                    y: state.sledPosition.ymm
                };
                let len1 = length(pos1);
                let len2 = length({x: pos1.x + direction[0] * distanceMm, y: pos1.y + direction[1] * distanceMm});
                
                await Promise.allSettled([
                    motorDrivers.a.move(distanceToPulses(motorConfigs.a, len2.a - len1.a), timeMs),
                    motorDrivers.b.move(distanceToPulses(motorConfigs.b, len2.b - len1.b), timeMs)
                ]);
            }
        },

        async manualMoveStop(kind) {
            if (motorDrivers[kind]) {
                await motorDrivers[kind].stop();
            } else if (kind === "xy") {
                await Promise.allSettled([
                    motorDrivers.a.stop(),
                    motorDrivers.b.stop()
                ]);
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