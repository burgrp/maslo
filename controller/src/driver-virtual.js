const Debug = require("debug");

module.exports = async ({ motors }) => {

    return {

        async open() {
        },

        async createMotor(name, config) {

            let state = {
                steps: motors[name].steps,
                stops: [false, false],
                currentMA: 0,
                duty: 0
            };

            let log = Debug(`app:motor:${name}`);

            let checkIntervalMs = 10;
            setInterval(() => {
                let stallDuty = 0.1;
                if (state.duty > stallDuty || state.duty < -stallDuty) {
                    state.steps += config.maxRpm * config.encoderPpr * state.duty / (60000 / checkIntervalMs) * motors[name].orientation;
                }
            }, checkIntervalMs);

            return {
                name,

                async set(duty) {
                    log("set", Math.round(duty * 100) / 100);
                    state.duty = duty;
                },

                async get() {
                    return { ...state };
                }
            }
        },

        async createRelay(name) {
            let log = Debug(`app:relay:${name}`);

            let state = {
                on: false
            };

            return {
                name,
                state,

                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);
                    state.on = newOn;
                }
            }
        }

    }

}