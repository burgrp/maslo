module.exports = ({ i2c, address, maxRetries = 2 }) => {

    const COMMAND_SET = 1;

    let duty = 0;

    async function updateDuty() {
        let buffer = Buffer.alloc(3);
        buffer.writeUInt8(COMMAND_SET, 0);
        buffer.writeUInt8(Math.abs(duty * 0xFF), 1);
        buffer.writeUInt8(duty < 0 ? 0 : 1, 2);

        for (let attempt = 1; ; attempt++) {
            try {
                await i2c.i2cWrite(address, buffer);
                break;
            } catch (e) {
                if (attempt > maxRetries) {
                    throw e;
                }
            }
        }
    }

    setInterval(() => {
        updateDuty().catch(e => {
            console.error(e);
        });
    }, 500);

    return {

        async set(d) {
            duty = d;
            await updateDuty();
        },

        async get() {

            let buffer


            for (let attempt = 1; ; attempt++) {
                try {
                    buffer = await i2c.i2cRead(address, 1 + 1 + 4 + 2);
                    break;
                } catch (e) {
                    if (attempt > maxRetries) {
                        throw e;
                    }
                }
            }

            let duty = buffer.readUInt8(0);
            let flags = buffer.readUInt8(1);

            if ((flags & 1) === 0) {
                duty = -duty;
            }

            return {
                duty: duty / 0xFF,
                steps: buffer.readInt32LE(2),
                stops: [!!(buffer.readUInt8(1) >> 1 & 1), !!(buffer.readUInt8(1) >> 2 & 1)],
                currentMA: buffer.readInt16LE(6)
            }
        }

    }
}

