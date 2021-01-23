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
                moveStart: machine.moveStart,
                moveStop: machine.moveStop,
                switch: machine.switch,
                resetOrigin: machine.resetOrigin
            }
        }
    }
}