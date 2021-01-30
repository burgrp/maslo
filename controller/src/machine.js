const deepEqual = require("fast-deep-equal");

function distanceToPulses(motorConfig, distanceMm) {
    return distanceMm * motorConfig.encoderPpr * motorConfig.gearRatio / (motorConfig.mmPerRev);
}

function pulsesToDistance(motorConfig, pulses) {
    return pulses * motorConfig.mmPerRev / (motorConfig.encoderPpr * motorConfig.gearRatio);
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
    motorsToWorkspaceVerticalMm,
    manualMoveMm
}) => {

    let state = {
        motors: {},
        relays: {},
        spindle: {},
        userOrigin: {
            xMm: 0,
            yMm: motorsToWorkspaceVerticalMm + workspaceHeightMm
        },
        positionReference: {
            xMm: -1000,
            yMm: 700,
            ap: 0,
            bp: 0
        },
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
            let originAp = distanceToPulses(motorConfigs.a, sqrt(p2(state.motorsShaftDistanceMm / 2 + state.positionReference.xMm) + p2(state.positionReference.yMm))) - state.positionReference.ap;
            let originBp = distanceToPulses(motorConfigs.b, sqrt(p2(state.motorsShaftDistanceMm / 2 - state.positionReference.xMm) + p2(state.positionReference.yMm))) - state.positionReference.bp;

            // chain lengths
            let a = pulsesToDistance(motorConfigs.a, state.motors.a && state.motors.a.pulses + originAp);
            let b = pulsesToDistance(motorConfigs.b, state.motors.b && state.motors.b.pulses + originBp);

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
                xMm: aa - state.motorsShaftDistanceMm / 2,
                yMm: sqrt(p2(a) - p2(aa))
            };

        } else {
            delete state.sledPosition;
        }

        state.spindle.on = state.relays.spindle;

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
            state.motors[name] = motorDrivers[name].getState();
            checkState();
        }
        motorDrivers[name] = await driver.createMotor(name, update);
        state.motors[name] = {};
        update();
    }

    for (let name in relays) {
        function update() {
            state.relays[name] = relays[name].getState();
            checkState();
        }
        relays[name] = await driver.createRelay(name, relays[name], update);
        update();
    }

    function checkPositionReference() {
        if (!state.positionReference) {
            throw new Error("No position reference");
        }
    }

    async function moveRelativeAB(motor, speedMmpmin, distanceMm) {

        let timeMs = 60000 * Math.abs(distanceMm) / speedMmpmin;

        await motorDrivers[motor].move(
            distanceToPulses(motorConfigs[motor], distanceMm),
            timeMs
        );
    }

    async function moveAbsoluteXY(speedMmpmin, xMm, yMm) {

        checkPositionReference();

        let base = (a, b) => Math.sqrt(a * a + b * b);

        let length = pos => ({
            a: base(motorsShaftDistanceMm / 2 + pos.x, pos.y),
            b: base(motorsShaftDistanceMm / 2 - pos.x, pos.y)
        });

        let pos1 = { x: state.sledPosition.xMm, y: state.sledPosition.yMm };
        let pos2 = { x: xMm, y: yMm };

        let len1 = length(pos1);
        let len2 = length(pos2);

        let timeMs = 60000 * base(pos2.x - pos1.x, pos2.y - pos1.y) / speedMmpmin;

        await Promise.allSettled([
            motorDrivers.a.move(distanceToPulses(motorConfigs.a, len2.a - len1.a), timeMs),
            motorDrivers.b.move(distanceToPulses(motorConfigs.b, len2.b - len1.b), timeMs)
        ]);

    }

    async function moveRelativeXY(speedMmpmin, xMm, yMm) {

        checkPositionReference();

        await moveAbsoluteXY(speedMmpmin, state.sledPosition.xMm + xMm, state.sledPosition.yMm + yMm);
    }

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return state;
        },

        moveRelativeAB,
        moveAbsoluteXY,
        moveRelativeXY,

        async manualMoveStart(kind, ...direction) {

            if (kind == "a" || kind == "b") {

                await moveRelativeAB(
                    kind,
                    rapidMoveSpeedMmpmin, direction[0] * manualMoveMm
                );

            } if (kind == "z") {

                await moveRelativeAB(
                    kind,
                    50, direction[0] * manualMoveMm
                );

            } else if (kind === "xy") {

                await moveRelativeXY(
                    rapidMoveSpeedMmpmin,
                    direction[0] * manualMoveMm,
                    direction[1] * manualMoveMm
                );

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

        async setUserOrigin(xMm, yMm) {
            state.userOrigin = { xMm, yMm };
            checkState();
        }
    }
}