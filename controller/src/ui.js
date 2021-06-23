const machine = require("./machine")

module.exports = async ({ machine }) => {
    let events = {
        machine: {
            stateChanged: undefined
        }
    };

    machine.onStateChanged(state => {
        events.machine.stateChanged(state);
    });

    return {
        events,
        client: __dirname + "/client",
        api: {
            machine: {
                getState: machine.getState,

                async manualMotorStart(motor, direction) {
                    await machine.setMotorDuty(motor, 0.5 * direction);
                }, 

                async manualMotorStop(motor) {
                    await machine.setMotorDuty(motor, 0);
                },

                manualSwitch: machine.manualSwitch,

                async resetUserOrigin() {
                    let state = machine.getState();
                    if (state.sledPosition) {
                        if (state.userOrigin.xMm === state.sledPosition.xMm && state.userOrigin.yMm === state.sledPosition.yMm) {
                            await machine.setUserOrigin(0, state.motorsToWorkspaceVerticalMm + state.workspaceHeightMm);
                        } else {
                            await machine.setUserOrigin(state.sledPosition.xMm, state.sledPosition.yMm);
                        }
                    }
                }
            }
        }
    }
}