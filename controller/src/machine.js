const logError = require("debug")("app:error");

function distanceMmToSteps(motorConfig, distanceMm) {
    return distanceMm * motorConfig.encoderPpr * motorConfig.gearRatio / (motorConfig.mmPerRev);
}

function stepsToDistanceMm(motorConfig, steps) {
    return steps * motorConfig.mmPerRev / (motorConfig.encoderPpr * motorConfig.gearRatio);
}

module.exports = async ({
    drivers,
    driver,
    motors: motorConfigs,
    relays: relayConfigs,
    moveSpeedRapidMmPerMin,
    moveSpeedCuttingMmPerMin,
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
        positionReference: { // TODO: this is calibration
            xMm: -1000,
            yMm: 700,
            ap: 0,
            bp: 0
        },
        bitToMaterialAtLoStopMm: 20, // TODO: this is calibration
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

            // calculate step counter as sled would be at motor A
            let originAp = distanceMmToSteps(motorConfigs.a, sqrt(p2(state.motorsShaftDistanceMm / 2 + state.positionReference.xMm) + p2(state.positionReference.yMm))) - state.positionReference.ap;
            let originBp = distanceMmToSteps(motorConfigs.b, sqrt(p2(state.motorsShaftDistanceMm / 2 - state.positionReference.xMm) + p2(state.positionReference.yMm))) - state.positionReference.bp;

            // chain lengths
            let a = stepsToDistanceMm(motorConfigs.a, state.motors.a && state.motors.a.steps + originAp);
            let b = stepsToDistanceMm(motorConfigs.b, state.motors.b && state.motors.b.steps + originBp);

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

        state.spindle.on = state.relays.spindle.on;

        if (state.motors.z && isFinite(state.motors.z.lo.steps) && state.bitToMaterialAtLoStopMm) {
            state.spindle.bitToMaterialMm = stepsToDistanceMm(motorConfigs.z, state.motors.z.steps - state.motors.z.lo.steps) - state.bitToMaterialAtLoStopMm;
        } else {
            delete state.spindle.bitToMaterialMm;
        }

        let stateJson = JSON.stringify(state);
        if (stateJson !== oldStateJson) {
            oldStateJson = stateJson;
            for (let listener of stateChangedListeners) {
                try {
                    listener(state);
                } catch (error) {
                    logError("Error in machine state change listener:", error);
                }
            }
        }
    }

    if (!drivers[driver]) {
        throw new Error(`Unknown machine driver "${driver}"`);
    }

    driver = drivers[driver];
    await driver.open();

    let motorDrivers = {};
    for (let name in motorConfigs) {
        state.motors[name] = {};
        motorDrivers[name] = await driver.createMotor(name, state.motors[name]);
    }

    let relayDrivers = {};
    for (let name in relayConfigs) {
        state.relays[name] = {};
        relayDrivers[name] = await driver.createRelay(name, state.relays[name]);
    }

    async function moveRelativeABZ(motor, speedMmPerMin, distanceMm) {

        let timeMs = 60000 * Math.abs(distanceMm) / speedMmPerMin;

        await motorDrivers[motor].move(
            distanceMmToSteps(motorConfigs[motor], distanceMm),
            timeMs
        );
    }

    async function moveAbsoluteXY(speedMmPerMin, xMm, yMm) {
        checkState();

        if (!state.positionReference) {
            throw new Error("No position reference");
        }

        let base = (a, b) => Math.sqrt(a * a + b * b);

        let length = pos => ({
            a: base(motorsShaftDistanceMm / 2 + pos.x, pos.y),
            b: base(motorsShaftDistanceMm / 2 - pos.x, pos.y)
        });

        let pos1 = { x: state.sledPosition.xMm, y: state.sledPosition.yMm };
        let pos2 = { x: xMm, y: yMm };

        let len1 = length(pos1);
        let len2 = length(pos2);

        let timeMs = 60000 * base(pos2.x - pos1.x, pos2.y - pos1.y) / speedMmPerMin;

        await Promise.allSettled([
            motorDrivers.a.move(distanceMmToSteps(motorConfigs.a, len2.a - len1.a), timeMs),
            motorDrivers.b.move(distanceMmToSteps(motorConfigs.b, len2.b - len1.b), timeMs)
        ]);

    }

    async function moveRelativeXY(speedMmPerMin, xMm, yMm) {
        checkState();
        await moveAbsoluteXY(speedMmPerMin, state.sledPosition.xMm + xMm, state.sledPosition.yMm + yMm);
    }

    function scheduleNextCheck() {
        try {
            checkState();
        } catch (e) {
            logError("Error in periodic check:", e);
        }
        setTimeout(scheduleNextCheck, 100);
    }

    scheduleNextCheck();

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return state;
        },

        moveRelativeABZ,
        moveAbsoluteXY,
        moveRelativeXY,

        async manualMoveStart(kind, ...direction) {

            function getMoveSpeed() {
                if (!isFinite(state.spindle.bitToMaterialMm)) {
                    throw new Error("Unknown position of router bit. Please calibrate.");
                }

                return state.spindle.bitToMaterialMm < 0 ?
                    moveSpeedRapidMmPerMin :
                    moveSpeedCuttingMmPerMin;
            }

            if (kind == "a" || kind == "b") {

                await moveRelativeABZ(
                    kind,
                    getMoveSpeed(), direction[0] * manualMoveMm.ab
                );

            } if (kind == "z") {

                await moveRelativeABZ(
                    kind,
                    50, direction[0] * manualMoveMm.z
                );

            } else if (kind === "xy") {

                await moveRelativeXY(
                    getMoveSpeed(),
                    direction[0] * manualMoveMm.xy,
                    direction[1] * manualMoveMm.xy
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
            await relayDrivers[relay].switch(state);
        },

        async setUserOrigin(xMm, yMm) {
            state.userOrigin = { xMm, yMm };
        }
    }
}