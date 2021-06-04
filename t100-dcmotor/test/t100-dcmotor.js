module.exports = ({ i2c, address }) => {

    const COMMAND_SET = 1;

    return {

        async set(duty) {
            let buffer = Buffer.alloc(3);
            buffer.writeUInt8(COMMAND_SET, 0);
            buffer.writeUInt8(Math.abs(duty * 0xFF), 1);
            buffer.writeUInt8(duty < 0 ? 0 : 1, 2);
            await i2c.i2cWrite(address, buffer);
        },

        async get() {

            let buffer = await i2c.i2cRead(address, 1 + 1 + 4 + 2);

            let duty = buffer.readUInt8(0);
            let flags = buffer.readUInt8(1);

            if (flags & 1 === 0) {
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

