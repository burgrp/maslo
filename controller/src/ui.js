const logError = require("debug")("app:ui:error");

module.exports = async ({
    machine,
    manualMotorControl,
    manualCuttingSpeedMmPerMin,
    manualRapidSpeedMmPerMin,
    router
}) => {
    let events = {
        machine: {
            stateChanged: undefined
        },
        router: {
            jobChanged: undefined
        }
    };

    machine.onStateChanged(state => {
        events.machine.stateChanged(state);
    });

    router.onJobChanged(code => {
        events.router.jobChanged(code);
    });

    let motorAccelerationTimers = {};

    let { min, max, abs } = Math;

    async function manualMotorStart(motor, direction) {
        if (machine.getState().motors[motor].driver.duty === 0 && !motorAccelerationTimers[motor]) {
            let duty = manualMotorControl[motor].min * direction;
            await machine.setMotorDuty(motor, duty);
            motorAccelerationTimers[motor] = setInterval(async () => {
                try {
                    duty = direction * min(abs(duty + 0.02 * direction), manualMotorControl[motor].max);
                    await machine.setMotorDuty(motor, duty);
                } catch (e) {
                    logError("Error in manual motor acceleration timer", e);
                }
            }, 100);
        }
    }

    async function manualMotorStop(motor) {
        clearInterval(motorAccelerationTimers[motor]);
        delete motorAccelerationTimers[motor];
        await machine.setMotorDuty(motor, 0);
    }

    async function manualMoveStart(directionX, directionY) {
        let state = machine.getState();

        if (!isFinite(state.spindle.zMm)) {
            throw new Error("Unknown position of router bit. Please calibrate.");
        }

        let sled = { ...state.sledPosition };
        if (!sled) {
            throw new Error("Unknown sled position.");
        }

        sled.xMm = state.workspace.widthMm / 2 + sled.xMm;
        sled.yMm = state.motorsToWorkspaceVerticalMm + state.workspace.heightMm - sled.yMm;

        let safeToEdge = state.sledDiameterMm / 4;

        let xMm = directionX ? (directionX / 2 + 0.5) * state.workspace.widthMm - safeToEdge * directionX : sled.xMm;
        let yMm = directionY ? (directionY / 2 + 0.5) * state.workspace.heightMm - safeToEdge * directionY : sled.yMm;

        if (directionX && directionY) {
            let d = min(xMm * directionX - sled.xMm * directionX, yMm * directionY - sled.yMm * directionY);
            xMm = sled.xMm + d * directionX;
            yMm = sled.yMm + d * directionY;
        }

        let cutting = state.spindle.on;

        try {
            await router.start([{
                code: cutting ? "G1" : "G0",
                x: xMm,
                y: yMm,
                f: cutting ? manualCuttingSpeedMmPerMin : manualRapidSpeedMmPerMin
            }]);
        } catch (e) {
            if (!e.moveInterrupted) {
                throw e;
            }
        }

    }

    async function manualMoveStop() {
        await machine.interruptMove();
    }

    return {
        events,
        client: __dirname + "/client",
        api: {
            machine: {
                getState: machine.getState,

                async manualMoveStart(kind, ...params) {
                    if (kind === "xy") {
                        await manualMoveStart(...params);
                    } else {
                        await manualMotorStart(kind, ...params);
                    }
                },

                async manualMoveStop(kind) {
                    if (kind === "xy") {
                        await manualMoveStop();
                    } else {
                        await manualMotorStop(kind);
                    }
                },

                manualSwitch: machine.manualSwitch,

                async resetUserOrigin() {
                    let state = machine.getState();
                    if (state.sledPosition) {
                        if (state.userOrigin.xMm === state.sledPosition.xMm && state.userOrigin.yMm === state.sledPosition.yMm) {
                            await machine.setUserOrigin(-state.workspace.widthMm / 2, state.motorsToWorkspaceVerticalMm + state.workspace.heightMm);
                        } else {
                            await machine.setUserOrigin(state.sledPosition.xMm, state.sledPosition.yMm);
                        }
                    }
                },

                async emergencyStop() {
                    await machine.interruptMove();
                }
            },
            router: {
                getCode: router.getCode,
                start: router.start
            }
        }
    }
}