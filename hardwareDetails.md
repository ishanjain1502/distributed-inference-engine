H/W path           Device      Class       Description
======================================================
                               system      VX
/0                             bus         Motherboard
/0/0                           memory      96KiB BIOS
/0/400                         processor   AMD EPYC-Turin Processor
/0/1000                        memory      8GiB System Memory
/0/1000/0                      memory      8GiB DIMM RAM
/0/100                         bridge      82G33/G31/P35/P31 Express DRAM Controller
/0/100/1           /dev/fb0    display     bochs-drmdrmfb
/0/100/2                       bridge      QEMU PCIe Root port
/0/100/2/0                     network     Virtio network device
/0/100/2/0/0       enp1s0      network     Ethernet interface
/0/100/2.1                     bridge      QEMU PCIe Root port
/0/100/2.1/0                   bridge      Red Hat, Inc.
/0/100/2.1/0/1                 generic     6300ESB Watchdog Timer
/0/100/2.2                     bridge      QEMU PCIe Root port
/0/100/2.2/0                   bus         QEMU XHCI Host Controller
/0/100/2.2/0/0     usb1        bus         xHCI Host Controller
/0/100/2.2/0/0/1   input5      input       QEMU QEMU USB Tablet
/0/100/2.2/0/1     usb2        bus         xHCI Host Controller
/0/100/2.3                     bridge      QEMU PCIe Root port
/0/100/2.3/0                   storage     Virtio block device
/0/100/2.3/0/0     /dev/vda    disk        107GB Virtual I/O device
/0/100/2.3/0/0/1   /dev/vda1   volume      511MiB Windows FAT volume
/0/100/2.3/0/0/2   /dev/vda2   volume      99GiB EXT4 volume
/0/100/2.4                     bridge      QEMU PCIe Root port
/0/100/2.4/0                   generic     Virtio memory balloon
/0/100/2.4/0/0                 generic     Virtual I/O device
/0/100/2.5                     bridge      QEMU PCIe Root port
/0/100/2.5/0                   generic     Virtio RNG
/0/100/2.5/0/0                 generic     Virtual I/O device
/0/100/2.6                     bridge      QEMU PCIe Root port
/0/100/2.7                     bridge      QEMU PCIe Root port
/0/100/3                       bridge      QEMU PCIe Root port
/0/100/3.1                     bridge      QEMU PCIe Root port
/0/100/3.2                     bridge      QEMU PCIe Root port
/0/100/3.3                     bridge      QEMU PCIe Root port
/0/100/3.4                     bridge      QEMU PCIe Root port
/0/100/3.5                     bridge      QEMU PCIe Root port
/0/100/3.6                     bridge      QEMU PCIe Root port
/0/100/3.7                     bridge      QEMU PCIe Root port
/0/100/4                       bridge      QEMU PCIe Root port
/0/100/4.1                     bridge      QEMU PCIe Root port
/0/100/4.2                     bridge      QEMU PCIe Root port
/0/100/4.3                     bridge      QEMU PCIe Root port
/0/100/4.4                     bridge      QEMU PCIe Root port
/0/100/4.5                     bridge      QEMU PCIe Root port
/0/100/4.6                     bridge      QEMU PCIe Root port
/0/100/4.7                     bridge      QEMU PCIe Root port
/0/100/5                       bridge      QEMU PCIe Root port
/0/100/5.1                     bridge      QEMU PCIe Root port
/0/100/5.2                     bridge      QEMU PCIe Root port
/0/100/5.3                     bridge      QEMU PCIe Root port
/0/100/5.4                     bridge      QEMU PCIe Root port
/0/100/5.5                     bridge      QEMU PCIe Root port
/0/100/5.6                     bridge      QEMU PCIe Root port
/0/100/5.7                     bridge      QEMU PCIe Root port
/0/100/6                       bridge      QEMU PCIe Root port
/0/100/1b          card0       multimedia  82801I (ICH9 Family) HD Audio Controller
/0/100/1f                      bridge      82801IB (ICH9) LPC Interface Controller
/0/100/1f/0                    input       PnP device PNP0303
/0/100/1f/1                    input       PnP device PNP0f13
/0/100/1f/2                    system      PnP device PNP0b00
/0/100/1f/3                    system      PnP device PNP0c01
/0/100/1f.2        scsi2       storage     82801IR/IO/IH (ICH9R/DO/DH) 6 port SATA Controller [AHCI mode]
/0/100/1f.2/0.0.0  /dev/cdrom  disk        QEMU DVD-ROM
/0/100/1f.3                    bus         82801I (ICH9 Family) SMBus Controller
/1                 input0      input       Power Button
/2                 input1      input       AT Translated Set 2 keyboard
/3                 input3      input       VirtualPS/2 VMware VMMouse
/4                 input4      input       VirtualPS/2 VMware VMMouse