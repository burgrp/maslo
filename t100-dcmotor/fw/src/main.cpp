int LED_PIN = 22;
int IRQ_PIN = 5;
int ADDR_PIN = 3;
int SAFEBOOT_PIN = 8;

int PWM_PIN = 16;
int INA_PIN = 24;
int INB_PIN = 25;
int HALL_A_PIN = 6;
int HALL_B_PIN = 7;
int HALL_A_EXTINT = 6;

class VNH7070 {
  int pinInA;
  int pinInB;

  PWM pwm;

public:
  void init(int pinInA, int pinInB, int pinPwm, volatile target::tc::Peripheral *tcPwm) {

    pwm.init(tcPwm, pinPwm);

    this->pinInA = pinInA;
    this->pinInB = pinInB;

    target::PORT.OUTCLR.setOUTCLR(1 << pinInA | 1 << pinInB);
    target::PORT.DIRSET.setDIRSET(1 << pinInA | 1 << pinInB);
  }
  void set(unsigned int speed, bool direction) {
    target::PORT.OUTCLR.setOUTCLR(1 << pinInA | 1 << pinInB);
    pwm.set(speed);
    if (speed) {
      if (direction) {
        target::PORT.OUTSET.setOUTSET(1 << pinInB);
      } else {
        target::PORT.OUTSET.setOUTSET(1 << pinInA);
      }
    }
  }
};

class EncoderCallback {
public:
  virtual void addSteps(int steps) = 0;
};

class Encoder {
  int pinA;
  int pinB;
  int extInA;

  EncoderCallback *callback;

public:
  void init(int pinA, int pinB, int extInA, EncoderCallback *callback) {

    this->pinA = pinA;
    this->pinB = pinB;
    this->extInA = extInA;
    this->callback = callback;

    target::PORT.OUTSET.setOUTSET(1 << pinA | 1 << pinB);
    target::PORT.PINCFG[pinA].setINEN(true).setPULLEN(true).setPMUXEN(true);
    target::PORT.PINCFG[pinB].setINEN(true).setPULLEN(true).setPMUXEN(true);

    if (pinA & 1) {
      target::PORT.PMUX[pinA >> 1].setPMUXO(target::port::PMUX::PMUXO::A);
    } else {
      target::PORT.PMUX[pinA >> 1].setPMUXE(target::port::PMUX::PMUXE::A);
    }

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::EIC)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    target::EIC.CTRL = target::EIC.CTRL.bare().setENABLE(true);
    while (target::EIC.STATUS)
      ;

    target::EIC.CONFIG.setSENSE(extInA, target::eic::CONFIG::SENSE::RISE);
    target::EIC.INTENSET.setEXTINT(extInA, true);
  }

  void interruptHandlerEIC() {
    if (target::EIC.INTFLAG.getEXTINT(extInA)) {
      target::EIC.INTFLAG.setEXTINT(extInA, true);
      // callback->addSteps((target::PORT.IN.getIN() >> pinA) & 1 != (target::PORT.IN.getIN() >> pinB) & 1? 1: -1);
      callback->addSteps((target::PORT.IN.getIN() >> pinB) & 1 ? -1 : 1);
    }
  }
};

enum Command { NONE = 0, SET_SPEED = 1, SET_END_STEPS = 2 };

class Device : public atsamd::i2c::Slave, EncoderCallback {
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
    bool endStops : 2;
    unsigned char error : 5;
    int actSteps;
    int endSteps;
  } state;

  VNH7070 vnh7070;
  Encoder encoder;

  const int stopPrecision = 20;

  // const int stopPrecision = 50;

  void init(int axis) {

    target::PM.APBCMASK.setTC(1, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::TC1_TC2)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    encoder.init(HALL_A_PIN, HALL_B_PIN, HALL_A_EXTINT, this);
    vnh7070.init(INA_PIN, INB_PIN, PWM_PIN, &target::TC1);

    // I2C

    target::PORT.PMUX[7].setPMUXE(target::port::PMUX::PMUXE::C);
    target::PORT.PMUX[7].setPMUXO(target::port::PMUX::PMUXO::C);

    target::PORT.PINCFG[14].setPMUXEN(true);
    target::PORT.PINCFG[15].setPMUXEN(true);

    target::PM.APBCMASK.setSERCOM(0, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::SERCOM0_CORE)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    Slave::init(0x50 + axis, 0, atsamd::i2c::AddressMode::MASK, &target::SERCOM0);

    // IRQ

    target::PORT.OUTSET.setOUTSET(1 << IRQ_PIN);
    target::PORT.DIRSET.setDIRSET(1 << IRQ_PIN);
  }

  void irqSet() { target::PORT.OUTCLR.setOUTCLR(1 << IRQ_PIN); }

  void irqClear() { target::PORT.OUTSET.setOUTSET(1 << IRQ_PIN); }

  void checkState() {

    int diff = state.endSteps - state.actSteps;

    bool running = abs(diff) > stopPrecision;

    if (state.running && !running) {
      irqSet();
    }

    state.running = running;

    if (running) {
      vnh7070.set(state.speed, diff > 0);
      target::PORT.OUTSET.setOUTSET(1 << LED_PIN);
    } else {
      vnh7070.set(0, false);
      target::PORT.OUTCLR.setOUTCLR(1 << LED_PIN);
    }
  }

  void addSteps(int steps) {
    state.actSteps += steps;
    checkState();
  }

  void setSpeed(unsigned int speed) {
    state.speed = speed;
    checkState();
  }

  void setEndSteps(int endSteps) {
    state.endSteps = endSteps;
    checkState();
  }

  bool checkCommand(Command command, int index, int value, int paramsSize) {
    return rxBuffer.command == command && index == paramsSize;
  }

  virtual int getTxByte(int index) {
    irqClear();

    // send data in 7bits, due to the I2C STOP problem

    unsigned char *raw = ((unsigned char *)&state);

    unsigned char byte7 = 0;

    int absBitIndexBase = index * 7;
    for (int bitIndex7 = 0; bitIndex7 < 7; bitIndex7++) {
      int absBitIndex = bitIndex7 + absBitIndexBase;
      int byteIndex8 = absBitIndex >> 3;
      int bitIndex8 = absBitIndex & 0x07;
      int byte8 = byteIndex8 < sizeof(state) ? raw[byteIndex8] : 0;
      byte7 |= ((byte8 >> bitIndex8) & 1) << bitIndex7;
    }

    return byte7;
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
      return true;
    }
  }
};

Device device;

void interruptHandlerSERCOM0() { device.interruptHandlerSERCOM(); }
void interruptHandlerEIC() { device.encoder.interruptHandlerEIC(); }

void initApplication() {

  // enable safeboot
  atsamd::safeboot::init(SAFEBOOT_PIN, false, LED_PIN);

  // MCU clocked at 8MHz
  target::SYSCTRL.OSC8M.setPRESC(target::sysctrl::OSC8M::PRESC::_1);

  device.init(readConfigPin(ADDR_PIN));

  // enable interrupts
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::SERCOM0);
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::EIC);
}
