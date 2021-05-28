const Debug = require("debug");

module.exports = async ({ motors }) => {

    return {

        async open() {
        },

        async createMotor(name, listener) {
            let log = Debug(`app:motor:${name}`);

            return {
                name,

                getState() {
                    return {
                        steps: 0,
                        lo: { stop: false },
                        hi: { stop: false },
                        running: false,
                        currentMA: 0
                    }
                },

                async move(steps, timeMs) {
                    log(`move ${steps} steps in ${timeMs} ms`);
                },

                async stop() {

                }
            }
        },

        async createRelay(name, listener) {
            let log = Debug(`app:relay:${name}`);

            return {
                name,
                getState() {
                    return false;
                },
                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);
                    
                }
            }
        }

    }

}