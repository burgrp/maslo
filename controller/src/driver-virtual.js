const Debug = require("debug");

module.exports = async () => {

    return {

        async open() {
        },

        async createMotor(name, config) {

            let state = {
                steps: Math.round(200000 * Math.random()) - 100000, //config.virtual && config.virtual.steps || 0,
                stops: [false, false],
                currentMA: 0,
                duty: 0
            };

            let log = Debug(`app:motor:${name}`);

            let checkIntervalMs = 10;
            setInterval(() => {
                let stallDuty = 0.1;
                let duty = Math.sign(state.duty) * Math.pow(Math.abs(state.duty), 4);
                if (duty > stallDuty || duty < -stallDuty) {
                    state.steps +=
                        config.maxRpm * config.encoderPpr * duty / (60000 / checkIntervalMs) *
                        (config.virtual && config.virtual.motorPolarity || 1) *
                        (config.virtual && config.virtual.encoderPolarity || 1);
                }
            }, checkIntervalMs);

            return {
                name,

                async set(duty) {
                    //log("set", Math.round(duty * 100) / 100);
                    state.duty = duty;
                },

                async get() {
                    return { ...state };
                }
            }
        },

        async createRelay(name) {
            let log = Debug(`app:relay:${name}`);

            let on = false;

            return {
                name,
                async get() {
                    return { on };
                },

                async set(newOn) {
                    on = newOn;
                    //log(`switch ${on ? "on" : "off"}`);
                }
            }
        }

    }

}