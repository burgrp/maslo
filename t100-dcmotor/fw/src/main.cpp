const int PIN_LED = 24;
const int PIN_IRQ = 23;
const int PIN_ADDR = 3;
const int PIN_SAFEBOOT = 8;

const int PIN_FWD = 16;
const int PIN_REV = 22;
const int PIN_HALL_A = 6;
const int PIN_HALL_B = 7;
const int EXT_INT_HALL_A = 6;

const int PIN_SDA = 14;
const int PIN_SCL = 15;

const int PIN_STOP1 = 4;
const int PIN_STOP2 = 5;

const int LO_PRIO_CHECK_MS = 100;

enum Command { NONE = 0, SET = 1 };

class Device : public atsamd::i2c::Slave, EncoderCallback, genericTimer::Timer {
public:
  struct __attribute__((packed)) {
    unsigned char command = Command::NONE;
    union {
      struct __attribute__((packed)) {
        unsigned char duty;
        bool direction : 1;
        bool reserved : 7;
      } setSpeed;
    };
  } rxBuffer;

  struct __attribute__((packed)) {
    unsigned char duty =  50;
    bool direction : 1 = 1;
    bool endStop1 : 1;
    bool endStop2 : 1;
    bool reserved : 5;
    int actSteps;
    short currentMA;
  } state;

  ZXBM5210 zxbm5210;
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

    // init VNH7070

    zxbm5210.init(PIN_FWD, PIN_REV, &target::TC1);

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

    checkState();

    // start check timer
    start(LO_PRIO_CHECK_MS / 10);
  }

  void irqSet() { target::PORT.DIRSET.setDIRSET(1 << PIN_IRQ); }

  void irqClear() { target::PORT.DIRCLR.setDIRCLR(1 << PIN_IRQ); }

  void checkState() {

    zxbm5210.set(state.duty, state.direction);

    bool running = state.duty != 0;
    target::PORT.OUTCLR.setOUTCLR(!running << PIN_LED);
    target::PORT.OUTSET.setOUTSET(running << PIN_LED);
  }

  void ecoderChanged(int steps) {
    state.actSteps += steps;
    checkState();
    // irqSet();
  }

  void setSpeed(unsigned int speed) {}

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

      if (checkCommand(Command::SET, index, value, sizeof(rxBuffer.setSpeed))) {
        state.duty = rxBuffer.setSpeed.duty;
        state.direction = rxBuffer.setSpeed.direction;
        checkState();
      }

      return true;

    } else {
      return false;
    }
  }

  void onTimer() {
    state.endStop1 = target::PORT.IN.getIN() >> PIN_STOP1 & 1;
    state.endStop2 = target::PORT.IN.getIN() >> PIN_STOP2 & 1;

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
