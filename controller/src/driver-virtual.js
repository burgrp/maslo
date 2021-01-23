const Debug = require("debug");

module.exports = async ({ }) => {

    function now() {
        return new Date().getTime();
    }

    return {
        async createMotor(name, config, listener) {
            let log = Debug(`app:motor:${name}`);

            let endTimeout;
            let resolveMove;
            let pulses = 0;

            return {
                name,
                ...config,

                getPulses() {
                    return pulses
                },

                async move(speedPps, maxPulses = Infinity) {

                    let runTimeMs = maxPulses / Math.abs(speedPps) * 1000;
                    log(`move ${speedPps} pps, ${maxPulses} pulses (${runTimeMs} ms)`);

                    let startedAtMs = now();
                    let startedPulses = pulses;

                    function update() {
                        let actualRunTimeMs = now() - startedAtMs;
                        pulses = startedPulses + Math.ceil(actualRunTimeMs * speedPps / 1000);
                        log(`pulses: ${pulses}`);
                        listener();
                    }

                    let updateInterval = setInterval(update, 100);

                    await new Promise((resolve, reject) => {
                        resolveMove = resolve;
                        if (runTimeMs !== Infinity) {
                            endTimeout = setTimeout(resolve, runTimeMs);
                        }
                    });

                    clearInterval(updateInterval);

                    update();

                    log(`move finished`, Math.ceil(pulses));
                },

                async stop() {
                    if (endTimeout) {
                        clearTimeout(endTimeout);
                        endTimeout = undefined;
                    }
                    if (resolveMove) {
                        resolveMove();
                    }
                    log(`stop`);
                }
            }
        },

        async createRelay(name, config, listener) {
            let log = Debug(`app:relay:${name}`);

            let on = false;

            return {
                name,
                ...config,
                isOn() {
                    return on;
                },
                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);
                    if (newOn !== on) {
                        on = newOn;
                        listener();
                    }
                }
            }
        }

    }

}