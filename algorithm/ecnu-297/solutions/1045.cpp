#include <algorithm>
#include <iostream>
#include <string>

using namespace std;

int main() {
    string s;
    if (!(cin >> s)) return 0;
    int n = static_cast<int>(s.size());
    int first = 0, second = 1, matched = 0;

    // 延长子串不会降低对应的小数，先找字典序最大的后缀。
    while (second + matched < n) {
        if (s[first + matched] == s[second + matched]) {
            ++matched;
        } else if (s[first + matched] < s[second + matched]) {
            first = max(first + matched + 1, second);
            second = first + 1;
            matched = 0;
        } else {
            second += matched + 1;
            matched = 0;
        }
    }

    // 小数末尾的 0 不影响数值，按题意删去以获得最短子串。
    int end = n;
    while (end > first + 1 && s[end - 1] == '0') --end;
    cout << s.substr(first, end - first) << '\n';
}
