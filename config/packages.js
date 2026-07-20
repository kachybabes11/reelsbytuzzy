const packages = [
  {
    id: 1,
    slug: "essential-wedding",
    category: "Wedding",
    name: "Essential Wedding",
    description:
      "Perfect for intimate weddings and couples who want the day's highlights beautifully captured.",
    fullDescription:
      "The Essential Wedding package is designed for couples who want clean cinematic coverage of their day without missing key emotional moments. We focus on meaningful storytelling, polished color, and social-ready edits that preserve the joy and intimacy of your celebration.",
    mediaType: "image",
    mediaSrc: "/assets/beauty-1.jpg",
    features: [
      "Morning preparations",
      "Ceremony coverage",
      "Reception highlights",
      "4 cinematic reels",
      "1 highlight film (3-5 mins)",
      "Professional color grading"
    ],
    duration: "Up to 8 Hours",
    delivery: "7-14 Days",
    price: 400000,
    popular: false
  },
  {
    id: 2,
    slug: "signature-wedding",
    category: "Wedding",
    name: "Signature Wedding",
    description:
      "Our most popular package for couples who want complete storytelling from start to finish.",
    fullDescription:
      "Signature Wedding delivers complete narrative coverage from prep to final celebration moments. With premium reels, a story-led highlight film, and behind-the-scenes perspective, this package is built for couples who want a timeless visual archive with modern social polish.",
    mediaType: "image",
    mediaSrc: "/assets/beauty-2.jpg",
    features: [
      "Full-day coverage",
      "Bride & groom prep",
      "Ceremony & reception",
      "6 premium reels",
      "Highlight film",
      "Behind-the-scenes content",
      "Drone shots (if available)"
    ],
    duration: "Full Day",
    delivery: "5-10 Days",
    price: 650000,
    popular: true
  },
  {
    id: 3,
    slug: "brand-content-day",
    category: "Brand",
    name: "Brand Content Day",
    description:
      "Content designed to elevate your brand across social media and marketing campaigns.",
    fullDescription:
      "Brand Content Day is for businesses that need high-quality visuals with a strategic content angle. We combine creative direction and efficient production to generate polished assets you can repurpose across launches, campaigns, and daily social communication.",
    mediaType: "image",
    mediaSrc: "/assets/beauty-2.jpg",
    features: [
      "Strategy session",
      "Up to 10 short-form videos",
      "Product showcase",
      "Lifestyle content",
      "Professional editing"
    ],
    duration: "Half Day",
    delivery: "5 Days",
    price: 300000,
    popular: true
  },
  {
    id: 4,
    slug: "creator-package",
    category: "Personal Branding",
    name: "Creator Package",
    description:
      "Build a strong online presence with content tailored to your personal brand.",
    fullDescription:
      "The Creator Package is built to shape your personal brand with a consistent look and storytelling rhythm. We help you create content that feels authentic to your voice while maintaining premium visual quality that grows audience trust.",
    mediaType: "image",
    mediaSrc: "/assets/beauty-1.jpg",
    features: [
      "Content planning",
      "8 edited reels",
      "Personal branding shoot",
      "Creative direction",
      "Captions & formatting"
    ],
    duration: "4 Hours",
    delivery: "3-5 Days",
    price: 250000,
    popular: false
  },
  {
    id: 5,
    slug: "event-coverage",
    category: "Events",
    name: "Event Coverage",
    description:
      "Professional coverage for birthdays, conferences, launches, concerts, and private events.",
    fullDescription:
      "Event Coverage captures the pace, atmosphere, and standout moments of your event with cinematic precision. From social highlights to recap edits, this package ensures your event story stays valuable long after the day ends.",
    mediaType: "image",
    mediaSrc: "/assets/beauty-2.jpg",
    features: [
      "Event coverage",
      "Highlight reel",
      "Social media edits",
      "Professional color grading"
    ],
    duration: "Custom",
    delivery: "5-7 Days",
    price: 200000,
    popular: false
  },
  {
    id: 6,
    slug: "editing-creative-direction",
    category: "Post Production",
    name: "Editing & Creative Direction",
    description:
      "Already have footage? We'll transform it into a polished cinematic story.",
    fullDescription:
      "Editing and Creative Direction gives you a complete post-production partner. If you already shot your footage, we shape it into a compelling final piece with refined pacing, tone, sound, and narrative structure tailored to your objective.",
    mediaType: "image",
    mediaSrc: "/assets/beauty-1.jpg",
    features: [
      "Professional editing",
      "Color grading",
      "Sound design",
      "Motion graphics",
      "Creative consultation"
    ],
    duration: "Custom",
    delivery: "Depends on project",
    price: 100000,
    popular: false
  }
];

export default packages;