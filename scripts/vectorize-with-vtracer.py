#!/usr/bin/env python3
"""CLI adapter for the official Python VTracer binding used by Asset Forge."""
from argparse import ArgumentParser

import vtracer


parser = ArgumentParser(description="Trace a PNG into an SVG using VTracer's Python binding.")
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--colormode", default="color")
parser.add_argument("--mode", default="spline")
parser.add_argument("--filter_speckle", type=int, default=12)
parser.add_argument("--color_precision", type=int, default=5)
parser.add_argument("--path_precision", type=int, default=2)
arguments = parser.parse_args()

vtracer.convert_image_to_svg_py(
    arguments.input,
    arguments.output,
    colormode=arguments.colormode,
    mode=arguments.mode,
    filter_speckle=arguments.filter_speckle,
    color_precision=arguments.color_precision,
    path_precision=arguments.path_precision,
)
