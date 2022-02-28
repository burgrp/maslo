const tf = require('@tensorflow/tfjs-node');

const summaryWriter = tf.node.summaryFileWriter('/tmp/tfjs_tb_logdir');

for (let step = 0; step < 100; ++step) {
  summaryWriter.scalar('dummyValue', Math.sin(4 * Math.PI * step / 8), step);
}