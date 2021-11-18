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

    let manualMovePending = {};

    function asyncWait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }    

    async function manualMotorStart(motor, direction) {
        
        machine.checkStandbyMode();

        if (manualMovePending[motor]) {
            throw new Error(`Another move pending on motor ${motor}`);
        }

        try {
            manualMovePending[motor] = true;
            let d = manualMotorControl[motor].min;
            while (manualMovePending[motor]) {
                d = min(manualMotorControl[motor].max, d + 0.05);
                machine.setMotorDuty(motor, direction * d);
                await asyncWait(100);
            }
        } finally {
            machine.setMotorDuty(motor, 0);
        }
    }

    async function manualMotorStop(motor) {
        delete manualMovePending[motor];
    }

    async function manualMoveStart(directionX, directionY) {


        let state = machine.getState();

        if (!state.sled.position) {
            throw new Error(`Unknown sled position`);
        }

        let rapidMove = !state.spindle.on && state.spindle.zMm > 0;

        try {
            await router.run([{
                code: rapidMove ? "G0" : "G1",
                x: state.sled.position.xMm + 10000 * directionX,
                y: state.sled.position.yMm + 10000 * directionY,
                f: rapidMove? manualRapidSpeedMmPerMin: manualCuttingSpeedMmPerMin
            }]);
        } catch (e) {
            if (e.moveInterrupted) {
                machine.clearMoveInterrupt();
            } else {
                throw e;
            }
        }

    }

    async function manualMoveStop() {
        machine.interruptCurrentMove();
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
                    machine.setSledReference(0, state.workspace.heightMm / 2 - state.sled.diaMm / 2 - workspaceTopToSledTopMm);
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