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

    let { min, max, abs } = Math;

    let manualMotorPending = {};

    function asyncWait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }    

    async function manualMotorStart(motor, direction) {
        try {
            manualMotorPending[motor] = true;
            let d = 0;
            while (manualMotorPending[motor]) {
                d = min(1, d + 0.05);
                machine.setManualMotorDuty(motor, direction * d);
                await asyncWait(100);
            }
        } finally {
            machine.setManualMotorDuty(motor, 0);
        }
    }

    async function manualMotorStop(motor) {
        delete manualMotorPending[motor];
    }

    async function manualMoveStart(directionX, directionY) {
        let state = machine.getState();

        if (!isFinite(state.spindle.zMm)) {
            throw new Error("Unknown position of router bit. Please calibrate.");
        }

        // let sled = { ...state.sledPosition };
        // if (!sled) {
        //     throw new Error("Unknown sled position.");
        // }

        // sled.xMm = state.workspace.widthMm / 2 + sled.xMm;
        // sled.yMm = state.motorsToWorkspaceVerticalMm + state.workspace.heightMm - sled.yMm;

        // let safeToEdge = state.sledDiameterMm / 4;

        // let xMm = directionX ? (directionX / 2 + 0.5) * state.workspace.widthMm - safeToEdge * directionX : sled.xMm;
        // let yMm = directionY ? (directionY / 2 + 0.5) * state.workspace.heightMm - safeToEdge * directionY : sled.yMm;

        // if (directionX && directionY) {
        //     let d = min(xMm * directionX - sled.xMm * directionX, yMm * directionY - sled.yMm * directionY);
        //     xMm = sled.xMm + d * directionX;
        //     yMm = sled.yMm + d * directionY;
        // }

        // let cutting = state.spindle.on;

        // try {
        //     await router.run([{
        //         code: cutting ? "G1" : "G0",
        //         x: xMm,
        //         y: yMm,
        //         f: cutting ? manualCuttingSpeedMmPerMin : manualRapidSpeedMmPerMin
        //     }]);
        // } catch (e) {
        //     if (!e.moveInterrupted) {
        //         throw e;
        //     }
        // }

    }

    async function manualMoveStop() {
        // await machine.interruptMove();
    }

    return {
        events,
        client: __dirname + "/client",
        api: {
            machine: {
                getState() {
                    return machine.getState();
                },

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

                async manualSwitch(relay, state) {
                    // machine.checkStandbyMode();
                    // await machine.switchRelay(relay, state);
                },

                async resetUserOrigin() {
                    let state = machine.getState();
                    if (state.sled.position) {
                        if (state.userOrigin.xMm === state.sled.position.xMm && state.userOrigin.yMm === state.sled.position.yMm) {
                            machine.setUserOrigin(0, 0);
                        } else {
                            machine.setUserOrigin(state.sled.position.xMm, state.sled.position.yMm);
                        }
                    }
                },

                async emergencyStop() {
                    // await machine.interruptMove();
                },

                async setCalibrationXY(workspaceTopToSledTopMm) {
                    if (!Number.isFinite(workspaceTopToSledTopMm)) {
                        throw new Error("Please enter a valid number");
                    }
                    let state = machine.getState();
                    machine.setSledReference(0, state.workspace.heightMm - state.sled.diaMm / 2 - workspaceTopToSledTopMm);
                },

                async setCalibrationZ(zMm) {
                    if (!Number.isFinite(zMm)) {
                        throw new Error("Please enter a valid number");
                    }
                    machine.setSpindleReference(zMm);
                }
            },
            router: {
                async getCode() {
                    return await router.getCode();
                },
                async runJob() {
                //     machine.checkStandbyMode();
                //     await router.runJob();
                },
                async deleteJob() {
                //     machine.checkStandbyMode();
                //     await router.deleteJob();
                }
            }
        }
    }
}