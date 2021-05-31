const int PIN_LED = 22;
const int PIN_IRQ = 23;
const int PIN_ADDR = 3;
const int PIN_SAFEBOOT = 8;

const int PIN_INA = 24;
const int PIN_INB = 25;
const int PIN_PWM = 16;
const int PIN_CS = 2;
const int PIN_HALL_A = 6;
const int PIN_HALL_B = 7;
const int EXT_INT_HALL_A = 6;

const int PIN_SDA = 14;
const int PIN_SCL = 15;

const int PIN_STOP1 = 4;
const int PIN_STOP2 = 5;

const int STOP_TOLERANCE = 2;
// const int MIN_SPEED = 50;
const int LO_PRIO_CHECK_MS = 100;

enum Command { NONE = 0, SET_SPEED = 1, SET_END_STEPS = 2 };

class Device : public atsamd::i2c::Slave, EncoderCallback, genericTimer::Timer {
public:
  struct __attribute__((packed)) {
    unsigned char command = Command::NONE;
    union {
      struct __attribute__((packed)) {
        unsigned char speed;
      } setSpeed;
      struct __attribute__((packed)) {
        int steps;
      } setEndSteps;
    };
  } rxBuffer;

  struct __attribute__((packed)) {
    unsigned char speed;
    bool running : 1;
    bool endStop1 : 1;
    bool endStop2 : 1;
    bool reserved : 2;
    unsigned char error : 3;
    int actSteps;
    int endSteps;
    short currentMA;
  } state;

  VNH7070 vnh7070;
  Encoder encoder;

  void init(int axis) {
    
    // TC1 for VNH7070 PWM

    target::PM.APBCMASK.setTC(1, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::TC1_TC2)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    // ADC for WNH7070 current sense

    target::PM.APBCMASK.setADC(true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::ADC)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    // init VNH7070

    vnh7070.init(PIN_INA, PIN_INB, PIN_PWM, PIN_CS, &target::TC1);

    // init encoder

    encoder.init(PIN_HALL_A, PIN_HALL_B, EXT_INT_HALL_A, this);

    // I2C

    Slave::init(0x50 + axis, 0, atsamd::i2c::AddressMode::MASK, 0, target::gclk::CLKCTRL::GEN::GCLK0, PIN_SDA, PIN_SCL,
                target::port::PMUX::PMUXE::C);

    // IRQ

    target::PORT.OUTCLR.setOUTCLR(1 << PIN_IRQ);
    target::PORT.DIRCLR.setDIRCLR(1 << PIN_IRQ);

    // STOPs

    target::PORT.PINCFG[PIN_STOP1].setINEN(true).setPULLEN(true);
    target::PORT.PINCFG[PIN_STOP2].setINEN(true).setPULLEN(true);

    // start check timer
    start(LO_PRIO_CHECK_MS / 10);
  }

  void irqSet() { target::PORT.DIRSET.setDIRSET(1 << PIN_IRQ); }

  void irqClear() { target::PORT.DIRCLR.setDIRCLR(1 << PIN_IRQ); }

  void checkState() {

    int diff = state.endSteps - state.actSteps;

    bool running = state.speed && abs(diff) > STOP_TOLERANCE && !state.endStop1 && !state.endStop2 && state.error == 0;

    if (state.running != running) {
      state.running = running;
      irqSet();
    }

    if (running) {
      vnh7070.set(state.speed, diff > 0);
    } else {
      vnh7070.set(0, false);
    }

    if (state.error) {
      target::PORT.OUTTGL.setOUTTGL(1 << PIN_LED);
    } else {
      target::PORT.OUTCLR.setOUTCLR(!running << PIN_LED);
      target::PORT.OUTSET.setOUTSET(running << PIN_LED);
    }
  }

  void ecoderChanged(int steps) {
    state.actSteps += steps;
    checkState();
  }

  void setSpeed(unsigned int speed) {
    state.speed = speed;
    checkState();
  }

  void setEndSteps(int endSteps) {
    state.speed = 0;
    state.endSteps = endSteps;
    checkState();
  }

  bool checkCommand(Command command, int index, int value, int paramsSize) {
    return rxBuffer.command == command && index == paramsSize;
  }

  virtual int getTxByte(int index) {
    irqClear();
    return ((unsigned char *)&state)[index];
  }

  virtual bool setRxByte(int index, int value) {

    if (index < sizeof(rxBuffer)) {
      ((unsigned char *)&rxBuffer)[index] = value;

      if (checkCommand(Command::SET_SPEED, index, value, sizeof(rxBuffer.setSpeed))) {
        setSpeed(rxBuffer.setSpeed.speed);
      }

      if (checkCommand(Command::SET_END_STEPS, index, value, sizeof(rxBuffer.setEndSteps))) {
        setEndSteps(rxBuffer.setEndSteps.steps);
      }

      return true;

    } else {
      return false;
    }
  }

  void onTimer() {
    state.endStop1 = target::PORT.IN.getIN() >> PIN_STOP1 & 1;
    state.endStop2 = target::PORT.IN.getIN() >> PIN_STOP2 & 1;

    state.currentMA = vnh7070.getCurrentMA();

    checkState();

    start(LO_PRIO_CHECK_MS / 10);
  }
};

Device device;

void interruptHandlerSERCOM0() { device.interruptHandlerSERCOM(); }
void interruptHandlerEIC() { device.encoder.interruptHandlerEIC(); }

void initApplication() {

  // enable safeboot
  atsamd::safeboot::init(PIN_SAFEBOOT, false, PIN_LED);

  // MCU clocked at 8MHz
  target::SYSCTRL.OSC8M.setPRESC(target::sysctrl::OSC8M::PRESC::_1);
  genericTimer::clkHz = 8E6;

  device.init(readConfigPin(PIN_ADDR));

  // enable interrupts
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::SERCOM0);
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::EIC);
}
