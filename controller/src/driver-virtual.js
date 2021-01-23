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
            let pulseCounter = 0;
            let moving = false;

            return {
                name,
                ...config,

                getPulses() {
                    return pulseCounter
                },

                isMoving() {
                    return moving;
                },

                async move(direction, speedPps, pulses) {

                    if (moving) {
                        throw new Error("Already moving");
                    }

                    let runTimeMs = pulses / speedPps * 1000;
                    log(`move ${direction?"forward": "backward"} ${speedPps} pps, ${pulses} pulses (${runTimeMs} ms)`);

                    let startedAtMs = now();
                    let startedPulses = pulseCounter;

                    function update() {
                        let actualRunTimeMs = now() - startedAtMs;
                        pulseCounter = startedPulses + direction * Math.ceil(actualRunTimeMs * speedPps / 1000);
                        log(`pulses: ${pulseCounter}`);
                        listener();
                    }

                    let updateInterval = setInterval(update, 100);

                    try {

                        await new Promise((resolve, reject) => {
                            resolveMove = resolve;
                            if (runTimeMs !== Infinity) {
                                endTimeout = setTimeout(resolve, runTimeMs);
                            }
                        });

                    } finally {
                        clearInterval(updateInterval);

                        update();

                        log(`move finished`, Math.ceil(pulseCounter));
                        moving = false;
                    }
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