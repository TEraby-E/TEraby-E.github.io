#include <iostream>
#include <string>
using namespace std;

// 统一符号、前导零与小数尾零，避免浮点数舍入。
string normalize(const string &number) {
    size_t start = 0;
    bool negative = number[0] == '-';
    if (negative || number[0] == '+') ++start;

    size_t point = number.find('.', start);
    string integer = number.substr(start, point - start);
    string fraction = point == string::npos ? "" : number.substr(point + 1);
    size_t first = integer.find_first_not_of('0');
    integer = first == string::npos ? "0" : integer.substr(first);
    while (!fraction.empty() && fraction.back() == '0') fraction.pop_back();

    if (negative && (integer != "0" || !fraction.empty())) integer = "-" + integer;
    if (!fraction.empty()) integer += "." + fraction;
    return integer;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    string a, b;
    while (cin >> a >> b) {
        cout << (normalize(a) == normalize(b)
                     ? "It's xiao qiang" : "It isn't xiao qiang") << '\n';
    }
    return 0;
}
