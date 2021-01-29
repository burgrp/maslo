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
                manualMoveStart: machine.manualMoveStart,
                manualMoveStop: machine.manualMoveStop,
                manualSwitch: machine.manualSwitch,
                async resetUserOrigin() {
                    let state = machine.getState();
                    if (state.sledPosition) {
                        if (state.userOrigin.xmm === state.sledPosition.xmm && state.userOrigin.ymm === state.sledPosition.ymm) {
                            await machine.setUserOrigin(0, state.motorsToWorkspaceVerticalMm + state.workspaceHeightMm);
                        } else {
                            await machine.setUserOrigin(state.sledPosition.xmm, state.sledPosition.ymm);
                        }
                    }
                }
            }
        }
    }
}