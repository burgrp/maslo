const logError = require("debug")("app:machine:error");

module.exports = async ({
    machine,
    manualMotorControl,
    moveSpeedRapidMmPerMin,
    moveSpeedCuttingMmPerMin
}) => {
    let events = {
        machine: {
            stateChanged: undefined
        }
    };

    machine.onStateChanged(state => {
        events.machine.stateChanged(state);
    });

    let motorAccelerationTimers = {};

    let { min, max, abs } = Math;

    async function manualMotorStart(motor, direction) {
        if (machine.getState().motors[motor].driver.duty === 0 && !motorAccelerationTimers[motor]) {
            let duty = manualMotorControl[motor].min * direction;
            await machine.setMotorDuty(motor, duty);
            motorAccelerationTimers[motor] = setInterval(async () => {
                try {
                    duty = min(duty + 0.02 * direction, manualMotorControl[motor].max);
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

        if (!isFinite(state.spindle.depthMm)) {
            throw new Error("Unknown position of router bit. Please calibrate.");
        }

        let speedMmPerMin = state.spindle.depthMm < 0 ? moveSpeedRapidMmPerMin : moveSpeedCuttingMmPerMin;

        let sled = state.sledPosition;
        if (!sled) {
            throw new Error("Unknown sled position.");
        }

        let safeToEdge = state.sledDiameterMm / 4;

        let xMm = directionX ? directionX * (state.workspace.widthMm - safeToEdge) / 2 : sled.xMm;
        let yMm = directionY ? (directionY / 2 + 0.5) * (state.workspace.heightMm) + state.motorsToWorkspaceVerticalMm - safeToEdge * directionY : sled.yMm;

        if (directionX && directionY) {
            let d = min(xMm * directionX - sled.xMm * directionX, yMm * directionY - sled.yMm * directionY);
            xMm = sled.xMm + d * directionX;
            yMm = sled.yMm + d * directionY;
        }

        try {
            await machine.moveXY({
                xMm,
                yMm,
                speedMmPerMin,
                firstMove: true
            });
        } catch (e) {
            if (!e.moveInterrupted) {
                throw e;
            }
        } finally {
            await machine.stopAB();
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
                            await machine.setUserOrigin(0, state.motorsToWorkspaceVerticalMm + state.workspace.heightMm);
                        } else {
                            await machine.setUserOrigin(state.sledPosition.xMm, state.sledPosition.yMm);
                        }
                    }
                }
            }
        }
    }
}