int LED_PIN = 22;
int IRQ_PIN = 5;
int ADDR_PIN = 3;
int SAFEBOOT_PIN = 8;

int PWM_PIN = 16;
int INA_PIN = 24;
int INB_PIN = 25;

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

enum Command { NONE = 0, SET_MOTOR = 1, SET_END_STEPS = 2 };

class Device : public atsamd::i2c::Slave {
public:
  struct __attribute__((packed)) {
    unsigned char command = Command::NONE;
    union {
      struct __attribute__((packed)) {
        unsigned char speed;
        bool direction;
      } setMotor;
      struct __attribute__((packed)) {
        int steps;
      } setEndSteps;
    };
  } rxBuffer;

  struct __attribute__((packed)) {
    unsigned char speed;
    bool direction: 1;
    unsigned char error: 7;
  } txBuffer;

  VNH7070 vnh7070;

  int endSteps;
  int actSteps;

  void init(int axis) {

    target::PM.APBCMASK.setTC(1, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::TC1_TC2)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

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

  void setMotor(unsigned int speed, bool direction) {
    txBuffer.speed = speed;
    txBuffer.direction = direction;
    vnh7070.set(speed, direction);
    if (speed > 0) {
      target::PORT.OUTSET.setOUTSET(1 << LED_PIN);
    } else {
      target::PORT.OUTCLR.setOUTCLR(1 << LED_PIN);
    }
  }

  bool checkCommand(Command command, int index, int value, int paramsSize) {
    return rxBuffer.command == command && index == paramsSize;
  }

  virtual int getTxByte(int index) {
    irqClear();

    // send data in 7bits, due to the I2C STOP problem

    unsigned char *raw = ((unsigned char *)&txBuffer);

    unsigned char byte7 = 0;

    int absBitIndexBase = index * 7;
    for (int bitIndex7 = 0; bitIndex7 < 7; bitIndex7++) {
      int absBitIndex = bitIndex7 + absBitIndexBase;
      int byteIndex8 = absBitIndex >> 3;
      int bitIndex8 = absBitIndex & 0x07;
      int byte8 = byteIndex8 < sizeof(txBuffer) ? raw[byteIndex8] : 0;
      byte7 |= ((byte8 >> bitIndex8) & 1) << bitIndex7;
    }

    return byte7;
  }

  virtual bool setRxByte(int index, int value) {

    if (index < sizeof(rxBuffer)) {
      ((unsigned char *)&rxBuffer)[index] = value;

      if (checkCommand(Command::SET_MOTOR, index, value, sizeof(rxBuffer.setMotor))) {
        setMotor(rxBuffer.setMotor.speed, rxBuffer.setMotor.direction);
      }

      if (checkCommand(Command::SET_END_STEPS, index, value, sizeof(rxBuffer.setMotor))) {
        this->endSteps = rxBuffer.setEndSteps.steps;
      }

      return true;
    } else {
      return true;
    }
  }
};

Device device;

void interruptHandlerSERCOM0() { device.interruptHandlerSERCOM(); }

void initApplication() {

  // enable safeboot
  atsamd::safeboot::init(SAFEBOOT_PIN, false, LED_PIN);

  // MCU clocked at 8MHz
  target::SYSCTRL.OSC8M.setPRESC(target::sysctrl::OSC8M::PRESC::_1);

  device.init(readConfigPin(ADDR_PIN));

  // enable interrupts
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::SERCOM0);
}
