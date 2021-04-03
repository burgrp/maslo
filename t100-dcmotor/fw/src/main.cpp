const int LED_PIN = 22;
const int IRQ_PIN = 5;
const int ADDR_PIN = 3;
const int SAFEBOOT_PIN = 23;

const int INA_PIN = 24;
const int INB_PIN = 25;
const int PWM_PIN = 16;
const int SEL0_PIN = 23;
const int CS_PIN = 2;
const int HALL_A_PIN = 6;
const int HALL_B_PIN = 7;
const int HALL_A_EXTINT = 6;

const int STOP1_PIN = 8;
const int STOP2_PIN = 9;

const int STOP_STEPS = 20;
const int LO_PRIO_CHECK_MS = 100;

enum Command { NONE = 0, SET_SPEED = 1, SET_END_STEPS = 2 };

class ADC {
public:
  void init(int pin) {

    target::PM.APBCMASK.setADC(true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::ADC)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    if (pin & 1) {
      target::PORT.PMUX[pin >> 1].setPMUXO(target::port::PMUX::PMUXO::B);
    } else {
      target::PORT.PMUX[pin >> 1].setPMUXE(target::port::PMUX::PMUXE::B);
    }

    target::ADC.CTRLB = target::ADC.CTRLB.bare().setRESSEL(target::adc::CTRLB::RESSEL::_8BIT);
    target::ADC.AVGCTRL.setSAMPLENUM(target::adc::AVGCTRL::SAMPLENUM::_1024_SAMPLES).setADJRES(4);
    target::ADC.INPUTCTRL.setMUXNEG(target::adc::INPUTCTRL::MUXNEG::GND)
        .setMUXPOS(target::adc::INPUTCTRL::MUXPOS::PIN0);
    target::ADC.REFCTRL.setREFSEL(target::adc::REFCTRL::REFSEL::INTVCC1);
    target::ADC.CTRLA = target::ADC.CTRLA.bare().setENABLE(true);

    while (target::ADC.STATUS)
      ;
  }

  const int x = 1540 * 3300 / (2 * 1500);

  int getValue() {
    target::ADC.SWTRIG.setSTART(true);
    while (!target::ADC.INTFLAG.getRESRDY())
      ;

    return (target::ADC.RESULT.getRESULT() * x) >> 8;
  }
};

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
    unsigned char error : 5;
    int actSteps;
    int endSteps;
    short current;
  } state;

  VNH7070 vnh7070;
  Encoder encoder;
  ADC adc;

  void init(int axis) {

    // TC1 for VNH7070 PWM

    target::PM.APBCMASK.setTC(1, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::TC1_TC2)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    vnh7070.init(INA_PIN, INB_PIN, PWM_PIN, SEL0_PIN, &target::TC1);

    encoder.init(HALL_A_PIN, HALL_B_PIN, HALL_A_EXTINT, this);

    adc.init(CS_PIN);

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

    // STOPs

    target::PORT.PINCFG[STOP1_PIN].setINEN(true).setPULLEN(true);
    target::PORT.PINCFG[STOP2_PIN].setINEN(true).setPULLEN(true);

    // start check timer
    start(LO_PRIO_CHECK_MS / 10);
  }

  void irqSet() { target::PORT.OUTCLR.setOUTCLR(1 << IRQ_PIN); }

  void irqClear() { target::PORT.OUTSET.setOUTSET(1 << IRQ_PIN); }

  void checkState() {

    int diff = state.endSteps - state.actSteps;

    bool running = abs(diff) > STOP_STEPS && !state.endStop1 && !state.endStop2 && state.error == 0;

    if (state.running != running) {
      state.running = running;
      irqSet();
    }

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

  void onTimer() {
    state.endStop1 = target::PORT.IN.getIN() >> STOP1_PIN & 1;
    state.endStop2 = target::PORT.IN.getIN() >> STOP2_PIN & 1;

    state.current = adc.getValue();

    checkState();

    start(LO_PRIO_CHECK_MS / 10);
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
