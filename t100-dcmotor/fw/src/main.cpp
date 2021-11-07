const int PIN_LED = 22;
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

const int LO_PRIO_CHECK_MS = 100;
const int UNATTENDED_TIMEOUT_MS = 2000;
const int UNATTENDED_TIMEOUT_COUNT = UNATTENDED_TIMEOUT_MS / LO_PRIO_CHECK_MS;

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
    unsigned char duty;
    bool direction : 1;
    bool endStop1 : 1;
    bool endStop2 : 1;
    bool reserved : 5;
    int actSteps;
    short currentMA;
  } state;

  VNH7070 vnh7070;
  Encoder encoder;
  int unattendedTimeoutCounter;

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

    // STOPs

    target::PORT.PINCFG[PIN_STOP1].setINEN(true).setPULLEN(true);
    target::PORT.PINCFG[PIN_STOP2].setINEN(true).setPULLEN(true);

    // start check timer
    start(LO_PRIO_CHECK_MS / 10);
  }

  void checkState() {

    vnh7070.set((state.direction && !state.endStop1) || (!state.direction && !state.endStop2) ? state.duty : 0,
                state.direction);

    bool running = state.duty != 0;
    target::PORT.OUTCLR.setOUTCLR(!running << PIN_LED);
    target::PORT.OUTSET.setOUTSET(running << PIN_LED);
  }

  void ecoderChanged(int steps) {
    state.actSteps += steps;
    checkState();
  }

  void setSpeed(unsigned int speed) {}

  bool checkCommand(Command command, int index, int value, int paramsSize) {
    return rxBuffer.command == command && index == paramsSize;
  }

  virtual int getTxByte(int index) {
    return index < sizeof(state) ? ((unsigned char *)&state)[index] : 0;
  }

  virtual bool setRxByte(int index, int value) {

    if (index < sizeof(rxBuffer)) {
      ((unsigned char *)&rxBuffer)[index] = value;

      if (checkCommand(Command::SET, index, value, sizeof(rxBuffer.setSpeed))) {
        state.duty = rxBuffer.setSpeed.duty;
        state.direction = rxBuffer.setSpeed.direction;
        unattendedTimeoutCounter = 0;
        checkState();
      }

      return true;

    } else {
      return false;
    }
  }

  void onTimer() {
    unattendedTimeoutCounter++;
    if (unattendedTimeoutCounter > UNATTENDED_TIMEOUT_COUNT) {
      state.duty = 0;
    }

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
  //target::NVIC.IPR[target::interrupts::External::SERCOM0 >> 2].setPRI(target::interrupts::External::SERCOM0 & 0x03, 3); 
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::SERCOM0);
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::EIC);
}
